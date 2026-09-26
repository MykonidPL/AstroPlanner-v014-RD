#!/usr/bin/env python3
"""AstroPlanner R&D — Stage 4B.7s IFN SFD -> HEALPix v1 builder with guarded full-sky writer.

Purpose of this microstage:
- validate the frozen output grid contract: HEALPix NSIDE=256, RING, ICRS;
- measure mean/std raw SFD I100 in a native-map circular aperture r=0.5 deg;
- prove the path on a small control/sample set only.

The bounded canary modes remain available (explicit <=64 pixels and a fixed 4096-pixel grid).
A full-sky writer is present but is gated behind an explicit --full-sky flag, requires both SFD hemispheres, and stages output in temporary files before validated finalization.
This tool never changes AstroPlanner runtime, Score, UI, or recommendations.

Input contract:
- SFD_i100_4096_ngp.fits and/or SFD_i100_4096_sgp.fits
- OBJECT=I100, BUNIT=MJy/sr, GLON/GLAT-ZEA, LAM_NSGP=+1/-1.

Sampling contract in this stage:
- native SFD pixels only (no prior resampling/downsampling),
- circular sky aperture, radius 0.5 deg,
- inclusion by native pixel centre,
- mean and population std (ddof=0),
- raw SFD I100 scale; no zero-point subtraction.

HEALPix RING formulas follow the reference HEALPix C++ implementation
(pix2ang_z_phi / ang2pix_z_phi). The grid longitude/latitude is interpreted
as ICRS RA/Dec by the AstroPlanner output-grid contract.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np

BUILDER_VERSION = "4B.7s-gated-full-sky-1"
MODEL = "ifn-sfd-i100"
NSIDE = 256
NPIX = 12 * NSIDE * NSIDE
ORDERING = "RING"
FRAME = "ICRS"
APERTURE_RADIUS_DEG = 0.5
EXPECTED_SHAPE = (4096, 4096)
EXPECTED_OBJECT = "I100"
EXPECTED_BUNIT = "MJy/sr"
FULL_SKY_ASSET_BASENAME = "ifn-sfd-field-v1"
FULL_SKY_RECORD_COUNT = NPIX

SOURCE_FILENAMES = {
    +1: "SFD_i100_4096_ngp.fits",
    -1: "SFD_i100_4096_sgp.fits",
}
SOURCE_URLS = {
    +1: "https://portal.nersc.gov/project/cosmo/data/dust/v0_1/maps/SFD_i100_4096_ngp.fits",
    -1: "https://portal.nersc.gov/project/cosmo/data/dust/v0_1/maps/SFD_i100_4096_sgp.fits",
}

# ICRS/J2000 Cartesian -> Galactic Cartesian rotation matrix.
# Its transpose is Galactic -> ICRS because the matrix is orthogonal.
ICRS_TO_GAL = np.array(
    [
        [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
        [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
        [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669],
    ],
    dtype=np.float64,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _parse_fits_value(raw: str) -> Any:
    text = raw.strip()
    if not text:
        return None
    if text.startswith("'"):
        # FITS strings use doubled single quotes as escaping.
        out = []
        i = 1
        while i < len(text):
            ch = text[i]
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    out.append("'")
                    i += 2
                    continue
                break
            out.append(ch)
            i += 1
        return "".join(out).rstrip()
    token = text.split("/", 1)[0].strip()
    if token == "T":
        return True
    if token == "F":
        return False
    token = token.replace("D", "E")
    try:
        if any(c in token.upper() for c in (".", "E")):
            return float(token)
        return int(token)
    except ValueError:
        return token


def read_primary_fits_header(path: Path) -> tuple[dict[str, Any], int]:
    """Read the primary FITS header and return (header, data_offset_bytes)."""
    header: dict[str, Any] = {}
    blocks = 0
    with path.open("rb") as f:
        while True:
            block = f.read(2880)
            if len(block) != 2880:
                raise RuntimeError(f"truncated FITS header: {path}")
            blocks += 1
            end_seen = False
            for pos in range(0, 2880, 80):
                card = block[pos : pos + 80].decode("ascii", errors="strict")
                key = card[:8].strip()
                if key == "END":
                    end_seen = True
                    break
                if not key or card[8:10] != "= ":
                    continue
                header[key] = _parse_fits_value(card[10:])
            if end_seen:
                return header, blocks * 2880


def _clean_unit(value: Any) -> str:
    return str(value or "").strip().replace(" ", "").lower()


@dataclass
class SfdMap:
    path: Path
    header: dict[str, Any]
    data_offset: int
    data: np.memmap
    nsgp: int
    scale: float
    crpix1_zero: float
    crpix2_zero: float
    bscale: float
    bzero: float
    sha256: str

    @classmethod
    def open(cls, path: Path, expected_nsgp: int | None = None) -> "SfdMap":
        header, offset = read_primary_fits_header(path)
        if header.get("SIMPLE") is not True:
            raise RuntimeError(f"not a SIMPLE primary FITS: {path}")
        if int(header.get("BITPIX", 0)) != -32:
            raise RuntimeError(f"expected BITPIX=-32 in {path}, got {header.get('BITPIX')!r}")
        if int(header.get("NAXIS", 0)) != 2:
            raise RuntimeError(f"expected NAXIS=2 in {path}")
        shape = (int(header.get("NAXIS2", 0)), int(header.get("NAXIS1", 0)))
        if shape != EXPECTED_SHAPE:
            raise RuntimeError(f"expected shape {EXPECTED_SHAPE}, got {shape} in {path}")
        if str(header.get("OBJECT", "")).strip().upper() != EXPECTED_OBJECT:
            raise RuntimeError(f"expected OBJECT=I100 in {path}, got {header.get('OBJECT')!r}")
        if _clean_unit(header.get("BUNIT")) != _clean_unit(EXPECTED_BUNIT):
            raise RuntimeError(f"expected BUNIT=MJy/sr in {path}, got {header.get('BUNIT')!r}")
        if str(header.get("CTYPE1", "")).strip().upper() != "GLON-ZEA":
            raise RuntimeError(f"expected CTYPE1=GLON-ZEA in {path}")
        if str(header.get("CTYPE2", "")).strip().upper() != "GLAT-ZEA":
            raise RuntimeError(f"expected CTYPE2=GLAT-ZEA in {path}")

        nsgp = int(header.get("LAM_NSGP", 0))
        if nsgp not in (-1, +1):
            raise RuntimeError(f"invalid LAM_NSGP={nsgp!r} in {path}")
        if expected_nsgp is not None and nsgp != expected_nsgp:
            raise RuntimeError(f"hemisphere mismatch in {path}: expected {expected_nsgp:+d}, got {nsgp:+d}")

        scale = float(header.get("LAM_SCAL", 0.0))
        if not math.isfinite(scale) or scale <= 0:
            raise RuntimeError(f"invalid LAM_SCAL in {path}: {scale!r}")
        crpix1 = float(header.get("CRPIX1", math.nan))
        crpix2 = float(header.get("CRPIX2", math.nan))
        if not (math.isfinite(crpix1) and math.isfinite(crpix2)):
            raise RuntimeError(f"invalid CRPIX in {path}")

        bscale = float(header.get("BSCALE", 1.0))
        bzero = float(header.get("BZERO", 0.0))
        data = np.memmap(path, dtype=">f4", mode="r", offset=offset, shape=shape, order="C")
        return cls(
            path=path,
            header=header,
            data_offset=offset,
            data=data,
            nsgp=nsgp,
            scale=scale,
            crpix1_zero=crpix1 - 1.0,
            crpix2_zero=crpix2 - 1.0,
            bscale=bscale,
            bzero=bzero,
            sha256=sha256_file(path),
        )

    def project_galactic(self, lon_deg: float, lat_deg: float) -> tuple[float, float]:
        l = math.radians(lon_deg % 360.0)
        b = math.radians(lat_deg)
        rho2 = 1.0 - self.nsgp * math.sin(b)
        rho = math.sqrt(max(0.0, rho2))
        dx = rho * math.cos(l) * self.scale
        dy = -self.nsgp * rho * math.sin(l) * self.scale
        return self.crpix1_zero + dx, self.crpix2_zero + dy

    def inverse_pixels(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        dx = (x - self.crpix1_zero) / self.scale
        dy = (y - self.crpix2_zero) / self.scale
        rho2 = dx * dx + dy * dy
        valid = rho2 <= (1.0 + 1e-12)
        sin_b = self.nsgp * (1.0 - rho2)
        sin_b = np.clip(sin_b, -1.0, 1.0)
        b = np.arcsin(sin_b)
        l = np.mod(np.arctan2(-self.nsgp * dy, dx), 2.0 * math.pi)
        return l, b, valid

    def values(self, yy: np.ndarray, xx: np.ndarray) -> np.ndarray:
        raw = np.asarray(self.data[yy, xx], dtype=np.float64)
        return raw * self.bscale + self.bzero


def measure_one_map(m: SfdMap, lon_deg: float, lat_deg: float, radius_deg: float) -> np.ndarray:
    # Skip hemispheres that cannot intersect the requested aperture.
    if m.nsgp > 0 and lat_deg < -radius_deg:
        return np.empty(0, dtype=np.float64)
    if m.nsgp < 0 and lat_deg > +radius_deg:
        return np.empty(0, dtype=np.float64)

    cx, cy = m.project_galactic(lon_deg, lat_deg)
    # At the Galactic equator the largest local Lambert scale is LAM_SCAL
    # pixels/radian in the tangential direction. 15% margin + 4 pixels protects
    # the 0.5-deg candidate box without scanning large parts of the map.
    half = int(math.ceil(m.scale * math.radians(radius_deg) * 1.15)) + 4

    x0 = max(0, int(math.floor(cx)) - half)
    x1 = min(m.data.shape[1] - 1, int(math.ceil(cx)) + half)
    y0 = max(0, int(math.floor(cy)) - half)
    y1 = min(m.data.shape[0] - 1, int(math.ceil(cy)) + half)
    if x1 < x0 or y1 < y0:
        return np.empty(0, dtype=np.float64)

    # Exact spherical aperture test directly in Cartesian space from the
    # SFD Lambert equal-area coordinates.  This avoids inverse trig +
    # haversine for every native pixel while preserving the same pixel-centre
    # inclusion contract.
    xs = np.arange(x0, x1 + 1, dtype=np.float64)
    ys = np.arange(y0, y1 + 1, dtype=np.float64)
    dx = (xs - m.crpix1_zero) / m.scale
    dy = (ys - m.crpix2_zero) / m.scale
    rho2 = dy[:, None] * dy[:, None] + dx[None, :] * dx[None, :]
    valid_proj = rho2 <= (1.0 + 1e-12)

    q = np.sqrt(np.clip(2.0 - rho2, 0.0, None))
    vx = dx[None, :] * q
    vy = (-m.nsgp * dy[:, None]) * q
    vz = m.nsgp * (1.0 - rho2)

    l0 = math.radians(lon_deg % 360.0)
    b0 = math.radians(lat_deg)
    cb0 = math.cos(b0)
    c0x = cb0 * math.cos(l0)
    c0y = cb0 * math.sin(l0)
    c0z = math.sin(b0)
    dot = vx * c0x + vy * c0y + vz * c0z
    inside = valid_proj & (dot >= math.cos(math.radians(radius_deg)) - 2e-15)

    if m.nsgp > 0:
        inside &= vz >= -1e-14
    else:
        # Strict south at the shared b=0 boundary prevents double counting.
        inside &= vz < -1e-14

    if not np.any(inside):
        return np.empty(0, dtype=np.float64)

    iy, ix = np.nonzero(inside)
    yy = (iy + y0).astype(np.intp)
    xx = (ix + x0).astype(np.intp)
    vals = m.values(yy, xx)
    return vals[np.isfinite(vals)]


def measure_aperture(maps: dict[int, SfdMap], lon_deg: float, lat_deg: float, radius_deg: float = APERTURE_RADIUS_DEG) -> dict[str, Any]:
    if not (-90.0 <= lat_deg <= 90.0):
        raise ValueError(f"invalid Galactic latitude: {lat_deg}")

    needs_north = lat_deg + radius_deg >= 0.0
    needs_south = lat_deg - radius_deg < 0.0
    if needs_north and +1 not in maps:
        raise RuntimeError("aperture intersects NGP hemisphere but NGP map is missing")
    if needs_south and -1 not in maps:
        raise RuntimeError("aperture intersects SGP hemisphere but SGP map is missing")

    parts = []
    for nsgp in (+1, -1):
        m = maps.get(nsgp)
        if m is not None:
            v = measure_one_map(m, lon_deg, lat_deg, radius_deg)
            if v.size:
                parts.append(v)
    if not parts:
        raise RuntimeError(f"aperture produced no finite pixels at l={lon_deg}, b={lat_deg}")
    values = np.concatenate(parts)
    return {
        "meanI100": float(np.mean(values)),
        "stdI100": float(np.std(values, ddof=0)),
        "nativePixelCount": int(values.size),
        "allFinite": bool(np.all(np.isfinite(values))),
    }


# ---------------- HEALPix RING reference formulas ----------------

def _isqrt(n: int) -> int:
    return math.isqrt(n)


def healpix_pix2ang_ring(nside: int, pix: int) -> tuple[float, float]:
    """Return (theta, phi) radians for the centre of 0-based RING pixel."""
    if nside <= 0:
        raise ValueError("nside must be positive")
    npix = 12 * nside * nside
    if not (0 <= pix < npix):
        raise ValueError(f"pixel out of range: {pix}")
    ncap = 2 * nside * (nside - 1)
    fact2 = 4.0 / npix
    fact1 = (2 * nside) * fact2

    if pix < ncap:
        iring = (1 + _isqrt(1 + 2 * pix)) // 2
        iphi = (pix + 1) - 2 * iring * (iring - 1)
        z = 1.0 - (iring * iring) * fact2
        phi = (iphi - 0.5) * (math.pi / 2.0) / iring
    elif pix < (npix - ncap):
        ip = pix - ncap
        iring = ip // (4 * nside) + nside
        iphi = ip % (4 * nside) + 1
        fodd = 1.0 if ((iring + nside) & 1) else 0.5
        nl2 = 2 * nside
        z = (nl2 - iring) * fact1
        phi = (iphi - fodd) * math.pi / nl2
    else:
        ip = npix - pix
        iring = (1 + _isqrt(2 * ip - 1)) // 2
        iphi = 4 * iring + 1 - (ip - 2 * iring * (iring - 1))
        z = -1.0 + (iring * iring) * fact2
        phi = (iphi - 0.5) * (math.pi / 2.0) / iring

    theta = math.acos(max(-1.0, min(1.0, z)))
    return theta, phi % (2.0 * math.pi)


def healpix_ang2pix_ring(nside: int, theta: float, phi: float) -> int:
    """Return 0-based RING pixel containing (theta, phi) radians."""
    if nside <= 0:
        raise ValueError("nside must be positive")
    if not (0.0 <= theta <= math.pi):
        raise ValueError("theta out of range")
    npix = 12 * nside * nside
    ncap = 2 * nside * (nside - 1)
    z = math.cos(theta)
    za = abs(z)
    tt = (phi % (2.0 * math.pi)) / (math.pi / 2.0)

    if za <= (2.0 / 3.0):
        temp1 = nside * (0.5 + tt)
        temp2 = nside * z * 0.75
        jp = int(temp1 - temp2)
        jm = int(temp1 + temp2)
        ir = nside + 1 + jp - jm
        kshift = 1 - (ir & 1)
        ip = (jp + jm - nside + kshift + 1) // 2
        ip %= 4 * nside
        return ncap + (ir - 1) * 4 * nside + ip

    tp = tt - int(tt)
    tmp = nside * math.sqrt(3.0 * (1.0 - za))
    jp = int(tp * tmp)
    jm = int((1.0 - tp) * tmp)
    ir = jp + jm + 1
    ip = int(tt * ir) % (4 * ir)
    if z > 0:
        return 2 * ir * (ir - 1) + ip
    return npix - 2 * ir * (ir + 1) + ip


def spherical_to_cart(lon_deg: float, lat_deg: float) -> np.ndarray:
    lon = math.radians(lon_deg)
    lat = math.radians(lat_deg)
    c = math.cos(lat)
    return np.array([c * math.cos(lon), c * math.sin(lon), math.sin(lat)], dtype=np.float64)


def cart_to_spherical(vec: np.ndarray) -> tuple[float, float]:
    v = np.asarray(vec, dtype=np.float64)
    v = v / np.linalg.norm(v)
    lon = math.degrees(math.atan2(v[1], v[0])) % 360.0
    lat = math.degrees(math.asin(float(np.clip(v[2], -1.0, 1.0))))
    return lon, lat


def icrs_to_galactic(ra_deg: float, dec_deg: float) -> tuple[float, float]:
    return cart_to_spherical(ICRS_TO_GAL @ spherical_to_cart(ra_deg, dec_deg))


def galactic_to_icrs(lon_deg: float, lat_deg: float) -> tuple[float, float]:
    return cart_to_spherical(ICRS_TO_GAL.T @ spherical_to_cart(lon_deg, lat_deg))


def angular_offset_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    a = spherical_to_cart(lon1, lat1)
    b = spherical_to_cart(lon2, lat2)
    return math.degrees(math.acos(float(np.clip(np.dot(a, b), -1.0, 1.0))))


def healpix_pixel_icrs(pix: int, nside: int = NSIDE) -> tuple[float, float]:
    theta, phi = healpix_pix2ang_ring(nside, pix)
    return math.degrees(phi) % 360.0, 90.0 - math.degrees(theta)


def healpix_pixel_for_icrs(ra_deg: float, dec_deg: float, nside: int = NSIDE) -> int:
    return healpix_ang2pix_ring(nside, math.radians(90.0 - dec_deg), math.radians(ra_deg))


def self_test_healpix() -> dict[str, Any]:
    # Deterministic boundary-heavy sample plus a stride across the full map.
    candidates = {
        0,
        1,
        2,
        3,
        NPIX - 1,
        NPIX - 2,
        2 * NSIDE * (NSIDE - 1) - 1,
        2 * NSIDE * (NSIDE - 1),
        NPIX - 2 * NSIDE * (NSIDE - 1) - 1,
        NPIX - 2 * NSIDE * (NSIDE - 1),
    }
    candidates.update(range(0, NPIX, 7919))
    failures = []
    for pix in sorted(candidates):
        theta, phi = healpix_pix2ang_ring(NSIDE, pix)
        back = healpix_ang2pix_ring(NSIDE, theta, phi)
        if back != pix:
            failures.append({"pix": pix, "back": back})
    if failures:
        raise RuntimeError(f"HEALPix RING round-trip failed: {failures[:5]}")
    return {"nside": NSIDE, "npix": NPIX, "testedPixels": len(candidates), "roundTripFailures": 0}


def source_manifest(maps: dict[int, SfdMap]) -> list[dict[str, Any]]:
    out = []
    for nsgp in (+1, -1):
        m = maps.get(nsgp)
        if m is None:
            continue
        out.append(
            {
                "hemisphere": "NGP" if nsgp > 0 else "SGP",
                "filename": m.path.name,
                "expectedCanonicalFilename": SOURCE_FILENAMES[nsgp],
                "url": SOURCE_URLS[nsgp],
                "sha256": m.sha256,
                "object": str(m.header.get("OBJECT", "")).strip(),
                "unit": str(m.header.get("BUNIT", "")).strip(),
                "ctype1": str(m.header.get("CTYPE1", "")).strip(),
                "ctype2": str(m.header.get("CTYPE2", "")).strip(),
                "lamNsgp": m.nsgp,
                "lamScal": m.scale,
            }
        )
    return out


def build_control_record(maps: dict[int, SfdMap], name: str, gal_l: float, gal_b: float) -> dict[str, Any]:
    direct = measure_aperture(maps, gal_l, gal_b)
    ra, dec = galactic_to_icrs(gal_l, gal_b)
    pix = healpix_pixel_for_icrs(ra, dec)
    pix_ra, pix_dec = healpix_pixel_icrs(pix)
    pix_l, pix_b = icrs_to_galactic(pix_ra, pix_dec)
    grid = measure_aperture(maps, pix_l, pix_b)
    return {
        "name": name,
        "controlGalacticDeg": {"l": gal_l, "b": gal_b},
        "controlIcrsDeg": {"ra": ra, "dec": dec},
        "directAperture": direct,
        "healpix": {
            "nside": NSIDE,
            "ordering": ORDERING,
            "frame": FRAME,
            "pixel": pix,
            "centerIcrsDeg": {"ra": pix_ra, "dec": pix_dec},
            "centerGalacticDeg": {"l": pix_l, "b": pix_b},
            "offsetFromControlDeg": angular_offset_deg(ra, dec, pix_ra, pix_dec),
            "aperture": grid,
        },
    }


def parse_control(spec: str) -> tuple[str, float, float]:
    parts = [p.strip() for p in spec.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("control must be NAME,L_DEG,B_DEG")
    name = parts[0]
    if not name:
        raise argparse.ArgumentTypeError("control name cannot be empty")
    try:
        l = float(parts[1])
        b = float(parts[2])
    except ValueError as exc:
        raise argparse.ArgumentTypeError("control l/b must be numbers") from exc
    if not math.isfinite(l) or not math.isfinite(b) or not (-90 <= b <= 90):
        raise argparse.ArgumentTypeError("invalid control coordinates")
    return name, l % 360.0, b


def parse_pixel_list(spec: str) -> list[int]:
    out: list[int] = []
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        p = int(token)
        if not (0 <= p < NPIX):
            raise argparse.ArgumentTypeError(f"pixel {p} outside [0,{NPIX - 1}]")
        out.append(p)
    if not out:
        raise argparse.ArgumentTypeError("pixel list is empty")
    if len(out) > 64:
        raise argparse.ArgumentTypeError("Stage 4B.7s explicit smoke list allows at most 64 pixels")
    return out


def make_even_canary_pixels_4096() -> list[int]:
    """Return exactly 4096 deterministic, unique RING pixels spanning the full grid."""
    count = 4096
    pixels = [int(round(i * (NPIX - 1) / (count - 1))) for i in range(count)]
    if len(pixels) != count or len(set(pixels)) != count:
        raise RuntimeError("4096-pixel canary generation did not produce unique pixels")
    if pixels[0] != 0 or pixels[-1] != NPIX - 1:
        raise RuntimeError("4096-pixel canary does not span the full HEALPix index range")
    return pixels


def build_pixel_record(maps: dict[int, SfdMap], pix: int) -> dict[str, Any]:
    ra, dec = healpix_pixel_icrs(pix)
    l, b = icrs_to_galactic(ra, dec)
    ap = measure_aperture(maps, l, b)
    return {
        "pixel": pix,
        "centerIcrsDeg": {"ra": ra, "dec": dec},
        "centerGalacticDeg": {"l": l, "b": b},
        "meanI100": ap["meanI100"],
        "stdI100": ap["stdI100"],
        "nativePixelCount": ap["nativePixelCount"],
    }



def write_canary_asset(
    pixel_records: list[dict[str, Any]],
    prefix: Path,
    maps: dict[int, SfdMap],
    canary_mode: str,
) -> tuple[Path, Path, dict[str, Any]]:
    """Write a bounded <=4096-record canary; never a full-sky runtime asset."""
    if not pixel_records:
        raise RuntimeError("canary binary writer requires canary pixel records")
    if len(pixel_records) > 4096:
        raise RuntimeError("canary binary writer is hard-limited to 4096 records")
    if canary_mode == "even-sky-4096" and len(pixel_records) != 4096:
        raise RuntimeError("even-sky-4096 mode requires exactly 4096 records")
    if canary_mode == "explicit-smoke" and len(pixel_records) > 64:
        raise RuntimeError("explicit-smoke canary remains limited to 64 records")

    rows = np.empty((len(pixel_records), 2), dtype=np.float64)
    pixel_indices: list[int] = []
    for i, rec in enumerate(pixel_records):
        mean = float(rec["meanI100"])
        std = float(rec["stdI100"])
        pix = int(rec["pixel"])
        if not (math.isfinite(mean) and math.isfinite(std)):
            raise RuntimeError(f"non-finite canary value at HEALPix pixel {pix}")
        if std < 0.0:
            raise RuntimeError(f"negative std at HEALPix pixel {pix}: {std}")
        rows[i, 0] = mean
        rows[i, 1] = std
        pixel_indices.append(pix)

    # Frozen binary record contract: little-endian Float32, interleaved mean,std.
    packed = np.asarray(rows, dtype=np.dtype("<f4"))
    binary_path = prefix.with_suffix(".bin")
    manifest_path = prefix.with_suffix(".json")
    binary_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    binary_path.write_bytes(packed.tobytes(order="C"))

    expected_bytes = len(pixel_records) * 2 * np.dtype("<f4").itemsize
    actual_bytes = binary_path.stat().st_size
    if actual_bytes != expected_bytes:
        raise RuntimeError(
            f"binary byte length mismatch: expected {expected_bytes}, got {actual_bytes}"
        )

    decoded = np.fromfile(binary_path, dtype=np.dtype("<f4"))
    if decoded.size != len(pixel_records) * 2:
        raise RuntimeError(
            f"binary Float32 count mismatch: expected {len(pixel_records) * 2}, got {decoded.size}"
        )
    decoded = decoded.reshape((-1, 2))
    if not np.array_equal(decoded, packed):
        raise RuntimeError("binary round-trip mismatch after little-endian Float32 decode")
    if not bool(np.all(np.isfinite(decoded))):
        raise RuntimeError("binary round-trip produced non-finite values")

    manifest = {
        "schemaVersion": 1,
        "stage": "4B.7s",
        "kind": "bounded-canary-binary-not-runtime-asset",
        "generatedAt": utc_now(),
        "builderVersion": BUILDER_VERSION,
        "model": MODEL,
        "source": "SFD-100um-I100",
        "unit": EXPECTED_BUNIT,
        "fullSky": False,
        "canaryMode": canary_mode,
        "hardRecordLimit": 4096,
        "grid": {
            "type": "HEALPix",
            "nside": NSIDE,
            "npix": NPIX,
            "ordering": ORDERING,
            "frame": FRAME,
        },
        "aperture": {
            "radiusDeg": APERTURE_RADIUS_DEG,
            "statisticPrimary": "mean(I100)",
            "statisticSecondary": "std(I100)",
            "nativePixelSelection": "pixel-center within spherical aperture",
            "stdDof": 0,
            "zeroPointSubtraction": "none",
        },
        "binary": {
            "filename": binary_path.name,
            "dtype": "Float32",
            "endianness": "little",
            "layout": "interleaved meanI100,stdI100",
            "fields": ["meanI100", "stdI100"],
            "bytesPerRecord": 8,
            "recordCount": len(pixel_records),
            "byteLength": actual_bytes,
            "sha256": sha256_file(binary_path),
        },
        "pixelIndices": pixel_indices,
        "sources": source_manifest(maps),
        "validation": {
            "allFinite": True,
            "roundTripExactFloat32": True,
            "expectedByteLength": expected_bytes,
            "actualByteLength": actual_bytes,
        },
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return binary_path, manifest_path, manifest


def write_full_sky_asset(
    maps: dict[int, SfdMap],
    prefix: Path,
) -> tuple[Path, Path, dict[str, Any]]:
    """Build the complete NSIDE=256 field with staged, validated finalization.

    Safety contract:
    - both SFD hemispheres are mandatory;
    - the basename is frozen to ifn-sfd-field-v1;
    - exactly NPIX records are written as little-endian Float32 mean,std pairs;
    - no final .bin/.json is created until the staged binary and manifest pass checks;
    - on a handled failure during finalization, any newly finalized sibling is removed.
    """
    if set(maps) != {+1, -1}:
        raise RuntimeError("full-sky build requires exactly NGP and SGP maps")
    if prefix.name != FULL_SKY_ASSET_BASENAME:
        raise RuntimeError(
            f"full-sky asset prefix basename must be {FULL_SKY_ASSET_BASENAME!r}, got {prefix.name!r}"
        )
    if FULL_SKY_RECORD_COUNT != NPIX or NPIX != 12 * NSIDE * NSIDE:
        raise RuntimeError("full-sky record-count invariant is broken")

    final_bin = prefix.with_suffix(".bin")
    final_manifest = prefix.with_suffix(".json")
    prefix.parent.mkdir(parents=True, exist_ok=True)
    if final_bin.exists() or final_manifest.exists():
        raise RuntimeError(
            f"refusing to overwrite existing full-sky asset: {final_bin} / {final_manifest}"
        )

    temp_dir = Path(
        tempfile.mkdtemp(prefix=f".{FULL_SKY_ASSET_BASENAME}-build-", dir=str(prefix.parent))
    )
    temp_bin = temp_dir / final_bin.name
    temp_manifest = temp_dir / final_manifest.name
    expected_bytes = FULL_SKY_RECORD_COUNT * 2 * np.dtype("<f4").itemsize
    chunk_records = 4096
    chunk = np.empty((chunk_records, 2), dtype=np.dtype("<f4"))
    chunk_used = 0
    record_count = 0
    stream_sha = hashlib.sha256()

    try:
        with temp_bin.open("wb") as f:
            for pix in range(FULL_SKY_RECORD_COUNT):
                rec = build_pixel_record(maps, pix)
                mean = float(rec["meanI100"])
                std = float(rec["stdI100"])
                if not (math.isfinite(mean) and math.isfinite(std)):
                    raise RuntimeError(f"non-finite full-sky value at HEALPix pixel {pix}")
                if std < 0.0:
                    raise RuntimeError(f"negative std at HEALPix pixel {pix}: {std}")

                # Validate the values after the frozen Float32 cast as well.
                mean32 = np.float32(mean)
                std32 = np.float32(std)
                if not (np.isfinite(mean32) and np.isfinite(std32)):
                    raise RuntimeError(f"Float32 overflow/non-finite value at HEALPix pixel {pix}")

                chunk[chunk_used, 0] = mean32
                chunk[chunk_used, 1] = std32
                chunk_used += 1
                record_count += 1

                if chunk_used == chunk_records:
                    raw = chunk.tobytes(order="C")
                    f.write(raw)
                    stream_sha.update(raw)
                    chunk_used = 0

            if chunk_used:
                raw = chunk[:chunk_used].tobytes(order="C")
                f.write(raw)
                stream_sha.update(raw)

            f.flush()
            os.fsync(f.fileno())

        if record_count != FULL_SKY_RECORD_COUNT:
            raise RuntimeError(
                f"full-sky record count mismatch: expected {FULL_SKY_RECORD_COUNT}, got {record_count}"
            )
        actual_bytes = temp_bin.stat().st_size
        if actual_bytes != expected_bytes:
            raise RuntimeError(
                f"full-sky byte length mismatch: expected {expected_bytes}, got {actual_bytes}"
            )

        disk_sha = sha256_file(temp_bin)
        if disk_sha != stream_sha.hexdigest():
            raise RuntimeError("full-sky SHA-256 mismatch between streamed and on-disk bytes")

        decoded = np.memmap(temp_bin, dtype=np.dtype("<f4"), mode="r")
        try:
            if decoded.size != FULL_SKY_RECORD_COUNT * 2:
                raise RuntimeError(
                    f"full-sky Float32 count mismatch: expected {FULL_SKY_RECORD_COUNT * 2}, got {decoded.size}"
                )
            if not bool(np.all(np.isfinite(decoded))):
                raise RuntimeError("full-sky binary validation found non-finite Float32 values")
        finally:
            del decoded

        manifest = {
            "schemaVersion": 1,
            "stage": "4B.7s",
            "kind": "full-sky-field-asset",
            "generatedAt": utc_now(),
            "builderVersion": BUILDER_VERSION,
            "model": MODEL,
            "source": "SFD-100um-I100",
            "unit": EXPECTED_BUNIT,
            "fullSky": True,
            "buildComplete": True,
            "grid": {
                "type": "HEALPix",
                "nside": NSIDE,
                "npix": NPIX,
                "ordering": ORDERING,
                "frame": FRAME,
            },
            "aperture": {
                "radiusDeg": APERTURE_RADIUS_DEG,
                "statisticPrimary": "mean(I100)",
                "statisticSecondary": "std(I100)",
                "nativePixelSelection": "pixel-center within spherical aperture",
                "stdDof": 0,
                "zeroPointSubtraction": "none",
            },
            "binary": {
                "filename": final_bin.name,
                "dtype": "Float32",
                "endianness": "little",
                "layout": "interleaved meanI100,stdI100",
                "fields": ["meanI100", "stdI100"],
                "bytesPerRecord": 8,
                "recordCount": record_count,
                "byteLength": actual_bytes,
                "sha256": disk_sha,
            },
            "sources": source_manifest(maps),
            "validation": {
                "allFinite": True,
                "recordCountExact": record_count == FULL_SKY_RECORD_COUNT,
                "expectedRecordCount": FULL_SKY_RECORD_COUNT,
                "expectedByteLength": expected_bytes,
                "actualByteLength": actual_bytes,
                "sha256Verified": True,
                "stagedBeforeFinalization": True,
            },
        }
        temp_manifest.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        # Read the staged manifest back before exposing either final file.
        check = json.loads(temp_manifest.read_text(encoding="utf-8"))
        if check.get("buildComplete") is not True:
            raise RuntimeError("staged full-sky manifest is not marked buildComplete")
        if check.get("binary", {}).get("recordCount") != FULL_SKY_RECORD_COUNT:
            raise RuntimeError("staged full-sky manifest recordCount mismatch")
        if check.get("binary", {}).get("byteLength") != expected_bytes:
            raise RuntimeError("staged full-sky manifest byteLength mismatch")
        if check.get("binary", {}).get("sha256") != disk_sha:
            raise RuntimeError("staged full-sky manifest SHA-256 mismatch")

        # Finalization occurs only after every validation above has passed.
        # Roll back the first sibling if the second rename fails.
        bin_finalized = False
        manifest_finalized = False
        try:
            os.replace(temp_bin, final_bin)
            bin_finalized = True
            os.replace(temp_manifest, final_manifest)
            manifest_finalized = True
        except Exception:
            if manifest_finalized and final_manifest.exists():
                final_manifest.unlink()
            if bin_finalized and final_bin.exists():
                final_bin.unlink()
            raise

        return final_bin, final_manifest, manifest
    except Exception:
        # Final paths are normally untouched until validated finalization.
        # If a handled error occurs after one sibling is finalized, ensure no
        # partial newly-created asset remains.
        if final_bin.exists() and not final_manifest.exists():
            final_bin.unlink()
        if final_manifest.exists() and not final_bin.exists():
            final_manifest.unlink()
        raise
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 4B.7s SFD I100 -> HEALPix builder with bounded canaries and guarded full-sky writer")
    parser.add_argument("--ngp", type=Path, help="path to SFD_i100_4096_ngp.fits")
    parser.add_argument("--sgp", type=Path, help="path to SFD_i100_4096_sgp.fits")
    parser.add_argument("--control", action="append", default=[], metavar="NAME,L,B", help="measure a control field and the containing NSIDE=256 RING pixel")
    parser.add_argument("--pixels", type=parse_pixel_list, help="comma-separated explicit HEALPix RING pixels; max 64")
    parser.add_argument("--canary-grid-4096", action="store_true", help="use exactly 4096 deterministic HEALPix RING pixels spanning the full sky; requires both SFD maps and --canary-asset-prefix")
    parser.add_argument("--output", type=Path, default=Path("ifn-sfd-field-smoke-v1.json"))
    parser.add_argument(
        "--canary-asset-prefix",
        type=Path,
        help="write canary records as PREFIX.bin + PREFIX.json; explicit --pixels <=64 or fixed --canary-grid-4096",
    )
    parser.add_argument(
        "--full-sky",
        action="store_true",
        help="explicitly enable the complete 786432-record NSIDE=256 build; requires both SFD maps and --full-sky-asset-prefix",
    )
    parser.add_argument(
        "--full-sky-asset-prefix",
        type=Path,
        help=f"full-sky output prefix; basename must be {FULL_SKY_ASSET_BASENAME!r}; writes validated .bin + .json",
    )
    args = parser.parse_args()

    if args.ngp is None and args.sgp is None:
        parser.error("at least one of --ngp/--sgp is required")

    if args.full_sky:
        if args.ngp is None or args.sgp is None:
            parser.error("--full-sky requires both --ngp and --sgp")
        if args.full_sky_asset_prefix is None:
            parser.error("--full-sky requires --full-sky-asset-prefix")
        if args.full_sky_asset_prefix.name != FULL_SKY_ASSET_BASENAME:
            parser.error(
                f"--full-sky-asset-prefix basename must be {FULL_SKY_ASSET_BASENAME!r}"
            )
        if args.control or args.pixels or args.canary_grid_4096 or args.canary_asset_prefix is not None:
            parser.error("--full-sky cannot be combined with control/canary modes")
    else:
        if args.full_sky_asset_prefix is not None:
            parser.error("--full-sky-asset-prefix requires explicit --full-sky")
        if args.canary_grid_4096 and args.pixels:
            parser.error("--canary-grid-4096 and --pixels are mutually exclusive")
        if args.canary_grid_4096 and args.canary_asset_prefix is None:
            parser.error("--canary-grid-4096 requires --canary-asset-prefix")
        if args.canary_grid_4096 and (args.ngp is None or args.sgp is None):
            parser.error("--canary-grid-4096 requires both --ngp and --sgp")
        if not args.control and not args.pixels and not args.canary_grid_4096:
            parser.error("Stage 4B.7s requires a smoke/canary mode or explicit --full-sky")

    maps: dict[int, SfdMap] = {}
    if args.ngp is not None:
        maps[+1] = SfdMap.open(args.ngp, expected_nsgp=+1)
    if args.sgp is not None:
        maps[-1] = SfdMap.open(args.sgp, expected_nsgp=-1)

    hp_test = self_test_healpix()

    if args.full_sky:
        binary_path, manifest_path, manifest = write_full_sky_asset(
            maps, args.full_sky_asset_prefix
        )
        print(json.dumps({
            "stage": "4B.7s",
            "mode": "full-sky",
            "records": manifest["binary"]["recordCount"],
            "bytes": manifest["binary"]["byteLength"],
            "sha256": manifest["binary"]["sha256"],
            "binary": str(binary_path),
            "manifest": str(manifest_path),
            "healpixRoundTripFailures": hp_test["roundTripFailures"],
        }, ensure_ascii=False))
        return 0

    controls = [parse_control(x) for x in args.control]
    control_records = [build_control_record(maps, name, l, b) for name, l, b in controls]
    if args.canary_grid_4096:
        pixels = make_even_canary_pixels_4096()
        canary_mode = "even-sky-4096"
    else:
        pixels = args.pixels or []
        canary_mode = "explicit-smoke"
    pixel_records = [build_pixel_record(maps, p) for p in pixels]

    if args.canary_asset_prefix is not None and not pixels:
        parser.error("--canary-asset-prefix requires --pixels or --canary-grid-4096")

    canary_result = None
    if args.canary_asset_prefix is not None:
        binary_path, manifest_path, manifest = write_canary_asset(
            pixel_records, args.canary_asset_prefix, maps, canary_mode
        )
        canary_result = {
            "binary": str(binary_path),
            "manifest": str(manifest_path),
            "records": manifest["binary"]["recordCount"],
            "bytes": manifest["binary"]["byteLength"],
            "sha256": manifest["binary"]["sha256"],
        }

    payload = {
        "schemaVersion": 1,
        "stage": "4B.7s",
        "kind": "smoke-validation-not-runtime-asset",
        "generatedAt": utc_now(),
        "builderVersion": BUILDER_VERSION,
        "model": MODEL,
        "source": "SFD-100um-I100",
        "unit": EXPECTED_BUNIT,
        "grid": {
            "type": "HEALPix",
            "nside": NSIDE,
            "npix": NPIX,
            "ordering": ORDERING,
            "frame": FRAME,
        },
        "aperture": {
            "radiusDeg": APERTURE_RADIUS_DEG,
            "statisticPrimary": "mean(I100)",
            "statisticSecondary": "std(I100)",
            "nativePixelSelection": "pixel-center within spherical aperture",
            "stdDof": 0,
            "zeroPointSubtraction": "none",
        },
        "sources": source_manifest(maps),
        "healpixSelfTest": hp_test,
        "controls": control_records,
        "pixels": pixel_records,
        "canaryAsset": canary_result,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "stage": "4B.7s",
        "controls": len(control_records),
        "pixels": len(pixel_records),
        "healpixRoundTripFailures": hp_test["roundTripFailures"],
        "output": str(args.output),
        "canaryAsset": canary_result,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
