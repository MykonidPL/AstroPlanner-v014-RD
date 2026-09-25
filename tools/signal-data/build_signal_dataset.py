#!/usr/bin/env python3
"""Build AstroPlanner's quantitative H-alpha signal dataset.

This is an offline build tool. It never runs in the PWA runtime.

Sources used in this stage:
- Finkbeiner (2003) composite all-sky H-alpha map (WHAM+VTSS+SHASSA),
  HEALPix Nside=512, for extended HII/emission nebulae/SNR targets.
- HASH / VizieR V/163 for Galactic planetary nebula H-alpha fluxes.
- The same pinned celestia_atlas catalog layer used by AstroPlanner for
  target identity/coordinates/geometry.

The builder stores source measurements and provenance. It deliberately does
NOT invent OIII values and does NOT convert a non-detection into zero signal.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import tempfile
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import healpy as hp
import numpy as np
import requests
from astropy.coordinates import SkyCoord
import astropy.units as u

CATALOG_COMMIT = "ef52c7ea920191d45fe0da4711dd3b1cc9220c18"
CATALOG_BASE = f"https://raw.githubusercontent.com/acocalypso/celestia_atlas/{CATALOG_COMMIT}/data"
CATALOG_URLS = {
    "openngc": f"{CATALOG_BASE}/openngc-viewer-catalog.json",
    "stellarium": f"{CATALOG_BASE}/stellarium-dso-supplement.json",
}
HALPHA_MAP_URL = "https://lambda.gsfc.nasa.gov/data/foregrounds/halpha/lambda_halpha_fwhm06_0512.fits"
HASH_TAP_URL = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
HASH_TABLE = 'V/163/pnmain'
HASH_FALLBACK_URLS = [
    "https://cdsarc.cds.unistra.fr/ftp/cats/V/163/pnmain.dat",
    "https://cdsarc.cds.unistra.fr/ftp/V/163/pnmain.dat",
    "https://vizier.cfa.harvard.edu/ftp/cats/V/163/pnmain.dat",
]

# One Rayleigh at H-alpha in observed energy surface flux per square arcsec.
# E_gamma(lambda=6562.8 A) * 10^6/(4*pi) photons cm^-2 s^-1 sr^-1,
# divided by arcsec^2 per sr. Kept explicit so the conversion is auditable.
H_PLANCK_ERG_S = 6.62607015e-27
C_CM_S = 2.99792458e10
HALPHA_WAVELENGTH_CM = 6562.8e-8
ARCSEC_PER_RAD = 206264.80624709636
ERG_CM2_S_ARCSEC2_PER_RAYLEIGH = (
    (H_PLANCK_ERG_S * C_CM_S / HALPHA_WAVELENGTH_CM)
    * 1e6 / (4.0 * math.pi)
    / (ARCSEC_PER_RAD ** 2)
)
LOG_SURFACE_FLUX_PER_RAYLEIGH = math.log10(ERG_CM2_S_ARCSEC2_PER_RAYLEIGH)

HTTP_CONNECT_TIMEOUT = 10
HTTP_READ_TIMEOUT = 60
HTTP_RETRIES = 2
MAX_JSON_BYTES = 15 * 1024 * 1024
MAX_MAP_BYTES = 20 * 1024 * 1024
MAX_HASH_BYTES = 40 * 1024 * 1024

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "AstroPlanner-RD-signal-builder/1.0"})


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_bytes(url: str, *, max_bytes: int, params: dict[str, str] | None = None) -> bytes:
    last: Exception | None = None
    for attempt in range(HTTP_RETRIES + 1):
        try:
            with SESSION.get(
                url,
                params=params,
                timeout=(HTTP_CONNECT_TIMEOUT, HTTP_READ_TIMEOUT),
                stream=True,
            ) as response:
                response.raise_for_status()
                out = bytearray()
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    out.extend(chunk)
                    if len(out) > max_bytes:
                        raise RuntimeError(f"download exceeded {max_bytes} bytes: {response.url}")
                return bytes(out)
        except Exception as exc:  # bounded retry, never infinite
            last = exc
            if attempt < HTTP_RETRIES:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"download failed after {HTTP_RETRIES + 1} attempts: {url}: {last}")


def fetch_json(url: str) -> Any:
    return json.loads(fetch_bytes(url, max_bytes=MAX_JSON_BYTES).decode("utf-8"))


def find_record_array(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("objects", "records", "data", "catalog", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [r for r in value if isinstance(r, dict)]
    best: list[dict[str, Any]] = []
    for value in payload.values():
        if isinstance(value, (dict, list)):
            rows = find_record_array(value)
            if len(rows) > len(best):
                best = rows
    return best


def flatten_strings(value: Any) -> list[str]:
    out: list[str] = []
    if value is None:
        return out
    if isinstance(value, (list, tuple)):
        for item in value:
            out.extend(flatten_strings(item))
    elif isinstance(value, (str, int, float)) and not isinstance(value, bool):
        text = str(value).strip()
        if text:
            out.append(text)
    return out


def normalize_alias(value: str) -> str:
    s = str(value or "").strip().upper()
    s = s.replace("SH2", "SH 2").replace("SH-2", "SH 2")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^A-Z0-9+\-. ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def aliases_from_record(r: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for key in ("id", "catalogId", "name", "displayName", "primaryName", "commonName", "aliases", "identifiers", "crossIds", "catalogIds"):
        out.extend(flatten_strings(r.get(key)))
    props = r.get("properties")
    if isinstance(props, dict):
        for key in ("name", "commonName", "m", "ngc", "ic", "abell", "aco", "ldn", "lbn", "barnard", "sharpless", "vdb", "rcw"):
            out.extend(flatten_strings(props.get(key)))
    seen: set[str] = set()
    clean: list[str] = []
    for alias in out:
        key = normalize_alias(alias)
        if key and key not in seen:
            seen.add(key)
            clean.append(alias.strip())
    return clean


def groups_from_record(r: dict[str, Any]) -> list[str]:
    vals: list[str] = []
    for key in ("catalogueGroups", "groups", "catalogGroups"):
        vals.extend(flatten_strings(r.get(key)))
    return [v.lower().strip() for v in vals if v.strip()]


def finite_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        n = float(str(value).strip().replace(",", "."))
    except (ValueError, TypeError):
        return None
    return n if math.isfinite(n) else None


def nested_value(r: dict[str, Any], keys: Iterable[str]) -> Any:
    for obj in (r, r.get("properties"), r.get("geometry"), r.get("size"), r.get("dimensions"), r.get("shape"), r.get("angles")):
        if not isinstance(obj, dict):
            continue
        for key in keys:
            if key in obj and obj[key] is not None:
                return obj[key]
    return None


def coerce_catalog_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, str):
        m = re.search(r"[-+]?\d+(?:[.,]\d+)?", value)
        return finite_number(m.group(0)) if m else None
    if isinstance(value, (list, tuple)):
        for item in value:
            n = coerce_catalog_number(item)
            if n is not None:
                return n
    if isinstance(value, dict):
        for key in ("value", "val", "amount", "number", "deg", "arcmin"):
            n = coerce_catalog_number(value.get(key))
            if n is not None:
                return n
    return None


def parse_axis_pair(value: Any) -> tuple[float, float] | None:
    if value is None:
        return None
    if isinstance(value, str):
        nums = [float(x.replace(",", ".")) for x in re.findall(r"[-+]?\d+(?:[.,]\d+)?", value)]
    elif isinstance(value, (list, tuple)):
        nums = [n for x in value if (n := coerce_catalog_number(x)) is not None]
    elif isinstance(value, dict):
        major = coerce_catalog_number(value.get("major", value.get("maj", value.get("width", value.get("x", value.get("a"))))))
        minor = coerce_catalog_number(value.get("minor", value.get("min", value.get("height", value.get("y", value.get("b"))))))
        if major is not None and minor is not None:
            return max(major, minor), min(major, minor)
        n = coerce_catalog_number(value.get("value"))
        return (n, n) if n is not None else None
    else:
        n = coerce_catalog_number(value)
        return (n, n) if n is not None else None
    nums = [n for n in nums if math.isfinite(n)]
    if len(nums) >= 2:
        return max(nums[0], nums[1]), min(nums[0], nums[1])
    return (nums[0], nums[0]) if nums else None


def geometry_from_record(r: dict[str, Any], source_key: str) -> tuple[float | None, float | None]:
    def get_num(keys: Iterable[str]) -> float | None:
        return coerce_catalog_number(nested_value(r, keys))

    # Runtime catalogue schemas currently used by AstroPlanner:
    # - OpenNGC compact rows expose root-level `major` / `minor` (arcmin),
    # - Stellarium supplement exposes `shape.majorArcmin` / `shape.minorArcmin`.
    # Keep the broader aliases for future/imported catalogue variants.
    major = get_num(("majorAxisArcmin", "majorArcmin", "major", "majAxArcmin", "major_axis_arcmin", "sizeArcmin", "diameterArcmin", "angularSizeArcmin", "MajAx", "majAx"))
    minor = get_num(("minorAxisArcmin", "minorArcmin", "minor", "minAxArcmin", "minor_axis_arcmin", "MinAx", "minAx"))
    major_deg = get_num(("majorAxisDeg", "major_axis_deg", "sizeMajorDeg", "diameterDeg"))
    minor_deg = get_num(("minorAxisDeg", "minor_axis_deg", "sizeMinorDeg"))
    if major is None and major_deg is not None:
        major = major_deg * 60.0
    if minor is None and minor_deg is not None:
        minor = minor_deg * 60.0
    pair = parse_axis_pair(nested_value(r, ("angularSizeArcminPair", "sizeArcminPair", "axisArcmin", "sizeArcminText", "dimensionsArcmin", "sizeText", "sizeLabel", "size", "dimensions", "angularSize")))
    if pair:
        if major is None:
            major = pair[0]
        if minor is None:
            minor = pair[1]
    pair_deg = parse_axis_pair(nested_value(r, ("sizeDeg", "dimensionsDeg", "angularSizeDeg")))
    if pair_deg:
        if major is None:
            major = pair_deg[0] * 60.0
        if minor is None:
            minor = pair_deg[1] * 60.0
    if source_key == "openngc":
        if major is None:
            major = get_num(("majorAxis", "MajAxis", "majAxis"))
        if minor is None:
            minor = get_num(("minorAxis", "MinAxis", "minAxis"))
    if major is not None and major <= 0:
        major = None
    if minor is not None and minor <= 0:
        minor = None
    if major is not None and minor is None:
        minor = major
    return major, minor


def classify_line_target(r: dict[str, Any]) -> str | None:
    code = str(r.get("typeCode") or r.get("type") or r.get("objectType") or "").strip()
    groups = groups_from_record(r)
    text = " ".join(flatten_strings([r.get("typeName"), r.get("typeLabel"), r.get("type")])).lower()
    if code == "SNR" or "supernova remnant" in text:
        return "supernova-remnant"
    if code == "HII" or any(g in {"sharpless", "sh2", "rcw"} for g in groups) or "hii region" in text:
        return "hii-region"
    if code == "EmN" or "emission nebula" in text:
        return "emission-nebula"
    return None


@dataclass
class MapTarget:
    source_key: str
    aliases: list[str]
    ra_deg: float
    dec_deg: float
    major_arcmin: float
    minor_arcmin: float
    physical_type: str


def collect_map_targets() -> tuple[list[MapTarget], dict[str, int], dict[str, Any]]:
    rows_by_source: dict[str, list[dict[str, Any]]] = {}
    source_counts: dict[str, int] = {}
    for key, url in CATALOG_URLS.items():
        rows = find_record_array(fetch_json(url))
        rows_by_source[key] = rows
        source_counts[key] = len(rows)

    diagnostics: dict[str, Any] = {
        "classifiedByType": {},
        "acceptedBeforeDedupByType": {},
        "rejectedBadCoordsByType": {},
        "rejectedMissingGeometryByType": {},
        "bySource": {},
    }
    classified_by_type = Counter()
    accepted_by_type = Counter()
    bad_coords_by_type = Counter()
    missing_geometry_by_type = Counter()

    candidates: list[MapTarget] = []
    for source_key, rows in rows_by_source.items():
        src = Counter()
        for r in rows:
            physical = classify_line_target(r)
            if not physical:
                continue
            src["classified"] += 1
            classified_by_type[physical] += 1
            ra = finite_number(r.get("raDeg", r.get("ra_deg", r.get("RAdeg"))))
            dec = finite_number(r.get("decDeg", r.get("dec_deg", r.get("DEdeg"))))
            if ra is None or dec is None or abs(dec) > 90:
                src["rejectedBadCoords"] += 1
                bad_coords_by_type[physical] += 1
                continue
            major, minor = geometry_from_record(r, source_key)
            if major is None or minor is None:
                src["rejectedMissingGeometry"] += 1
                missing_geometry_by_type[physical] += 1
                continue
            aliases = aliases_from_record(r)
            if not aliases:
                aliases = [str(r.get("uid") or f"{source_key}:{ra:.5f}:{dec:.5f}")]
            candidates.append(MapTarget(source_key, aliases, ra, dec, major, minor, physical))
            src["acceptedBeforeDedup"] += 1
            accepted_by_type[physical] += 1
        diagnostics["bySource"][source_key] = dict(src)

    # Cross-catalog deduplication: exact normalized alias + nearby coordinates.
    out: list[MapTarget] = []
    alias_index: dict[str, list[int]] = defaultdict(list)
    for item in sorted(candidates, key=lambda t: (t.physical_type, -t.major_arcmin)):
        duplicate_idx: int | None = None
        for alias in item.aliases:
            key = normalize_alias(alias)
            if not key:
                continue
            for idx in alias_index.get(key, []):
                other = out[idx]
                # generous only after an exact alias match
                if abs(other.ra_deg - item.ra_deg) <= 0.15 and abs(other.dec_deg - item.dec_deg) <= 0.15:
                    duplicate_idx = idx
                    break
            if duplicate_idx is not None:
                break
        if duplicate_idx is None:
            idx = len(out)
            out.append(item)
            for alias in item.aliases:
                key = normalize_alias(alias)
                if key:
                    alias_index[key].append(idx)
        else:
            old = out[duplicate_idx]
            merged_aliases = list(old.aliases)
            seen = {normalize_alias(a) for a in merged_aliases}
            for alias in item.aliases:
                k = normalize_alias(alias)
                if k and k not in seen:
                    seen.add(k)
                    merged_aliases.append(alias)
            # Prefer geometry with the larger resolved footprint.
            if item.major_arcmin * item.minor_arcmin > old.major_arcmin * old.minor_arcmin:
                old.major_arcmin, old.minor_arcmin = item.major_arcmin, item.minor_arcmin
            old.aliases = merged_aliases

    diagnostics["classifiedByType"] = dict(sorted(classified_by_type.items()))
    diagnostics["acceptedBeforeDedupByType"] = dict(sorted(accepted_by_type.items()))
    diagnostics["rejectedBadCoordsByType"] = dict(sorted(bad_coords_by_type.items()))
    diagnostics["rejectedMissingGeometryByType"] = dict(sorted(missing_geometry_by_type.items()))
    diagnostics["classified"] = sum(classified_by_type.values())
    diagnostics["acceptedBeforeDedup"] = len(candidates)
    diagnostics["deduplicatedCandidates"] = len(out)
    return out, source_counts, diagnostics

def download_to_file(url: str, path: Path, max_bytes: int) -> None:
    data = fetch_bytes(url, max_bytes=max_bytes)
    path.write_bytes(data)


def finite_map_values(values: np.ndarray) -> np.ndarray:
    arr = np.asarray(values, dtype=np.float64)
    good = np.isfinite(arr) & (arr != hp.UNSEEN)
    return arr[good]


def sample_halpha_map(map_values: np.ndarray, target: MapTarget) -> dict[str, Any] | None:
    coord = SkyCoord(ra=target.ra_deg * u.deg, dec=target.dec_deg * u.deg, frame="icrs").galactic
    lon = float(coord.l.deg)
    lat = float(coord.b.deg)
    vec = hp.ang2vec(lon, lat, lonlat=True)

    # Equivalent-area radius for catalogue ellipse. Ensure at least one beam radius.
    eq_radius_deg = 0.5 * math.sqrt(target.major_arcmin * target.minor_arcmin) / 60.0
    aperture_radius_deg = max(eq_radius_deg, 0.10)  # 6 arcmin
    inner_bg_deg = max(aperture_radius_deg * 1.35, aperture_radius_deg + 0.10)
    outer_bg_deg = max(aperture_radius_deg * 1.90, inner_bg_deg + 0.10)

    pix_target = hp.query_disc(512, vec, math.radians(aperture_radius_deg), nest=True, inclusive=True)
    pix_outer = hp.query_disc(512, vec, math.radians(outer_bg_deg), nest=True, inclusive=True)
    pix_inner = hp.query_disc(512, vec, math.radians(inner_bg_deg), nest=True, inclusive=False)
    pix_bg = np.setdiff1d(pix_outer, pix_inner, assume_unique=False)

    target_vals = finite_map_values(map_values[pix_target])
    bg_vals = finite_map_values(map_values[pix_bg])
    if target_vals.size < 3 or bg_vals.size < 5:
        return None

    p50 = float(np.percentile(target_vals, 50))
    p75 = float(np.percentile(target_vals, 75))
    p90 = float(np.percentile(target_vals, 90))
    bg50 = float(np.percentile(bg_vals, 50))
    bg75 = float(np.percentile(bg_vals, 75))
    excess50 = max(0.0, p50 - bg50)
    excess75 = max(0.0, p75 - bg50)
    excess90 = max(0.0, p90 - bg50)

    # Resolution/confidence describes the measurement, not target astrophysics.
    min_axis = min(target.major_arcmin, target.minor_arcmin)
    if min_axis >= 18:
        resolution_confidence = "high"
    elif min_axis >= 12:
        resolution_confidence = "medium"
    else:
        resolution_confidence = "low"

    # Do not interpret weak excess as zero emission; mark as non-quantitative detection.
    detect_floor = max(0.05, 0.08 * max(bg50, 0.0))
    detected = excess75 > detect_floor
    return {
        "kind": "halpha-map-aperture",
        "unit": "R",
        "mapNside": 512,
        "mapResolutionArcmin": 6.0,
        "apertureRadiusDeg": round(aperture_radius_deg, 6),
        "backgroundInnerRadiusDeg": round(inner_bg_deg, 6),
        "backgroundOuterRadiusDeg": round(outer_bg_deg, 6),
        "targetMedianRayleigh": round(p50, 6),
        "targetP75Rayleigh": round(p75, 6),
        "targetP90Rayleigh": round(p90, 6),
        "backgroundMedianRayleigh": round(bg50, 6),
        "backgroundP75Rayleigh": round(bg75, 6),
        "excessMedianRayleigh": round(excess50, 6),
        "excessP75Rayleigh": round(excess75, 6),
        "excessP90Rayleigh": round(excess90, 6),
        "detected": bool(detected),
        "resolutionConfidence": resolution_confidence,
        "targetPixelCount": int(target_vals.size),
        "backgroundPixelCount": int(bg_vals.size),
    }


def build_extended_records(work_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    targets, source_counts, target_selection = collect_map_targets()
    map_path = work_dir / "lambda_halpha_fwhm06_0512.fits"
    download_to_file(HALPHA_MAP_URL, map_path, MAX_MAP_BYTES)
    map_values = hp.read_map(str(map_path), field=0, nest=True, dtype=np.float64, memmap=True)
    expected = hp.nside2npix(512)
    if len(map_values) != expected:
        raise RuntimeError(f"unexpected H-alpha HEALPix length {len(map_values)} != {expected}")

    records: list[dict[str, Any]] = []
    stats = Counter()
    by_type = Counter()
    detected_by_type = Counter()
    for idx, target in enumerate(targets, start=1):
        stats["candidates"] += 1
        by_type[target.physical_type] += 1
        measurement = sample_halpha_map(map_values, target)
        if not measurement:
            stats["sampling_failed"] += 1
            continue
        stats["sampled"] += 1
        detected = bool(measurement["detected"])
        if detected:
            stats["detected"] += 1
            detected_by_type[target.physical_type] += 1
        confidence = measurement["resolutionConfidence"] if detected else "low"
        records.append({
            "id": f"finkbeiner:{target.source_key}:{idx}",
            "aliases": target.aliases,
            "raDeg": round(target.ra_deg, 8),
            "decDeg": round(target.dec_deg, 8),
            "physicalType": target.physical_type,
            "band": "Halpha",
            "signalModel": "line-surface-brightness" if detected else "line-map-nondetection",
            "quantitative": detected,
            "confidence": confidence,
            "geometry": {
                "majorAxisArcmin": round(target.major_arcmin, 5),
                "minorAxisArcmin": round(target.minor_arcmin, 5),
            },
            "measurement": measurement,
            "source": "Finkbeiner2003-Halpha-v1.1",
        })
    return records, {
        "catalogInputRows": source_counts,
        "targetSelection": target_selection,
        "candidatesByType": dict(sorted(by_type.items())),
        "detectedByType": dict(sorted(detected_by_type.items())),
        **dict(stats),
    }


def hash_tap_rows() -> list[dict[str, str]]:
    columns = ["HASH", "PNG", "RAJ2000", "DEJ2000", "Name", "SimbadID", "PNstat", "Domain", "MajDiam", "MinDiam", "logFHa", "f_logFHa", "e_logFHa", "r_logFHa"]
    select_cols = ", ".join(f'"{c}"' for c in columns)
    query = (
        f'SELECT {select_cols} FROM "{HASH_TABLE}" '
        'WHERE "Domain"=\'Galaxy\' AND ("PNstat"=\'T\' OR "PNstat"=\'L\' OR "PNstat"=\'P\')'
    )
    raw = fetch_bytes(
        HASH_TAP_URL,
        max_bytes=MAX_HASH_BYTES,
        params={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": query},
    ).decode("utf-8-sig", errors="replace")
    if "QUERY_STATUS" in raw[:1000] and "ERROR" in raw[:1000]:
        raise RuntimeError("VizieR TAP returned an error document")
    rows = list(csv.DictReader(io.StringIO(raw)))
    if not rows:
        raise RuntimeError("VizieR TAP returned zero HASH rows")
    return rows


def parse_hash_fixed_width(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in text.splitlines():
        if len(line) < 970:
            continue
        rows.append({
            "HASH": line[0:5].strip(),
            "PNG": line[6:17].strip(),
            "RAJ2000": line[18:27].strip(),
            "DEJ2000": line[28:37].strip(),
            "Name": line[99:130].strip(),
            "SimbadID": line[180:214].strip(),
            "PNstat": line[215:219].strip(),
            "Domain": line[220:226].strip(),
            "MajDiam": line[380:387].strip(),
            "MinDiam": line[393:400].strip(),
            "logFHa": line[961:969].strip(),
            "f_logFHa": line[970:975].strip(),
            "e_logFHa": line[976:985].strip(),
            "r_logFHa": line[993:1032].strip(),
        })
    return [r for r in rows if r.get("HASH")]


def hash_rows() -> tuple[list[dict[str, str]], str]:
    try:
        return hash_tap_rows(), "TAPVizieR"
    except Exception as tap_exc:
        print(f"::warning::HASH TAP query failed; trying bounded static mirrors: {tap_exc}", file=sys.stderr)
    errors: list[str] = []
    for url in HASH_FALLBACK_URLS:
        try:
            raw = fetch_bytes(url, max_bytes=MAX_HASH_BYTES).decode("utf-8", errors="replace")
            rows = parse_hash_fixed_width(raw)
            if rows:
                return rows, url
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError("HASH acquisition failed: " + " | ".join(errors))


def valid_hash_number(value: Any, sentinel: float | None = None) -> float | None:
    n = finite_number(value)
    if n is None:
        return None
    if sentinel is not None and abs(n - sentinel) < 1e-6:
        return None
    return n


def build_pn_records() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows, acquisition = hash_rows()
    records: list[dict[str, Any]] = []
    status_counts = Counter()
    flux_counts = Counter()
    for r in rows:
        status = str(r.get("PNstat") or "").strip()
        domain = str(r.get("Domain") or "").strip()
        status_counts[status or "blank"] += 1
        if domain and domain.lower() != "galaxy":
            continue
        if status not in {"T", "L", "P"}:
            continue
        log_flux = valid_hash_number(r.get("logFHa"), 999.9999)
        if log_flux is None:
            flux_counts["missingFlux"] += 1
            continue
        if not (-20 < log_flux < 0):
            flux_counts["invalidFlux"] += 1
            continue
        ra = valid_hash_number(r.get("RAJ2000"), 999.99999)
        dec = valid_hash_number(r.get("DEJ2000"), 999.99999)
        if ra is None or dec is None or abs(dec) > 90:
            flux_counts["badCoords"] += 1
            continue
        major = valid_hash_number(r.get("MajDiam"), 99999.9)
        minor = valid_hash_number(r.get("MinDiam"), 99999.9)
        if major is not None and major <= 0:
            major = None
        if minor is not None and minor <= 0:
            minor = None
        if major is not None and minor is None:
            minor = major
            assumed_circular = True
        else:
            assumed_circular = False

        err = valid_hash_number(r.get("e_logFHa"), 99.999999)
        mean_rayleigh: float | None = None
        log_surface: float | None = None
        if major is not None and minor is not None:
            area_arcsec2 = math.pi * 0.25 * major * minor
            if area_arcsec2 > 0:
                log_surface = log_flux - math.log10(area_arcsec2)
                mean_rayleigh = 10 ** (log_surface - LOG_SURFACE_FLUX_PER_RAYLEIGH)

        png = str(r.get("PNG") or "").strip()
        name = str(r.get("Name") or "").strip()
        simbad = str(r.get("SimbadID") or "").strip()
        aliases: list[str] = []
        for alias in ([f"PNG {png}", f"PN G{png}"] if png else []) + [name, simbad]:
            if alias and normalize_alias(alias) not in {normalize_alias(x) for x in aliases}:
                aliases.append(alias)

        if status == "T":
            confidence = "high"
        elif status == "L":
            confidence = "medium"
        else:
            confidence = "low"
        if assumed_circular and confidence == "high":
            confidence = "medium"
        if err is not None and err > 0.2 and confidence == "high":
            confidence = "medium"
        quantitative = mean_rayleigh is not None and math.isfinite(mean_rayleigh) and mean_rayleigh > 0
        flux_counts["validFlux"] += 1
        if quantitative:
            flux_counts["validSurfaceBrightness"] += 1
        else:
            flux_counts["integratedOnly"] += 1

        measurement: dict[str, Any] = {
            "kind": "integrated-halpha-flux",
            "logFluxErgCm2S": round(log_flux, 6),
            "fluxFlag": str(r.get("f_logFHa") or "").strip() or None,
            "logFluxErrorDex": round(err, 6) if err is not None else None,
            "majorAxisArcsec": round(major, 3) if major is not None else None,
            "minorAxisArcsec": round(minor, 3) if minor is not None else None,
            "assumedCircularForArea": assumed_circular,
            "logMeanSurfaceFluxErgCm2SArcsec2": round(log_surface, 8) if log_surface is not None else None,
            "meanSurfaceBrightnessRayleigh": round(mean_rayleigh, 6) if mean_rayleigh is not None else None,
        }
        records.append({
            "id": f"hash:{str(r.get('HASH') or '').strip()}",
            "aliases": aliases,
            "raDeg": round(ra, 8),
            "decDeg": round(dec, 8),
            "physicalType": "planetary-nebula",
            "band": "Halpha",
            "signalModel": "line-surface-brightness" if quantitative else "line-integrated-flux",
            "quantitative": bool(quantitative),
            "confidence": confidence,
            "pnStatus": status,
            "measurement": measurement,
            "source": "HASH-V163",
            "sourceReference": str(r.get("r_logFHa") or "").strip() or None,
        })
    return records, {
        "acquisition": acquisition,
        "inputRows": len(rows),
        "statusCounts": dict(sorted(status_counts.items())),
        **dict(flux_counts),
    }


def write_audit_markdown(path: Path, stats: dict[str, Any], records: list[dict[str, Any]], warnings: list[str]) -> None:
    counts = Counter(r.get("physicalType", "unknown") for r in records)
    quantitative = Counter(r.get("physicalType", "unknown") for r in records if r.get("quantitative"))
    lines = [
        "# AstroPlanner signal-data build audit",
        "",
        f"Generated: `{stats['generatedAt']}`",
        "",
        "## Dataset",
        "",
        f"- records: **{len(records)}**",
        f"- quantitative records: **{sum(1 for r in records if r.get('quantitative'))}**",
        f"- H-alpha conversion: `1 R = {ERG_CM2_S_ARCSEC2_PER_RAYLEIGH:.8e} erg cm^-2 s^-1 arcsec^-2`",
        "",
        "| physical type | records | quantitative |",
        "|---|---:|---:|",
    ]
    for key in sorted(counts):
        lines.append(f"| {key} | {counts[key]} | {quantitative[key]} |")
    lines += ["", "## Extended H-alpha map audit", "", "```json", json.dumps(stats.get("extendedMap", {}), ensure_ascii=False, indent=2), "```", "", "## Planetary nebula audit", "", "```json", json.dumps(stats.get("planetaryNebulae", {}), ensure_ascii=False, indent=2), "```"]
    if warnings:
        lines += ["", "## Warnings", ""] + [f"- {w}" for w in warnings]
    lines += [
        "",
        "## Interpretation constraints",
        "",
        "- A missing/non-detected map value is **not** zero astrophysical signal.",
        "- Finkbeiner H-alpha is observed surface brightness with no extinction correction; it contains diffuse Galactic foreground/background.",
        "- The map aperture stores robust target and local-background statistics; the Score engine must choose a calibrated statistic separately.",
        "- HASH integrated H-alpha is converted to mean surface brightness only when a usable angular area exists.",
        "- No OIII value is inferred from H-alpha.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="dist/signal-data")
    parser.add_argument("--skip-map", action="store_true")
    parser.add_argument("--skip-pn", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    all_records: list[dict[str, Any]] = []
    stats: dict[str, Any] = {"generatedAt": utc_now(), "builderVersion": 1}

    with tempfile.TemporaryDirectory(prefix="astroplanner-signal-") as tmp:
        work_dir = Path(tmp)
        if not args.skip_map:
            try:
                records, map_stats = build_extended_records(work_dir)
                all_records.extend(records)
                stats["extendedMap"] = map_stats
            except Exception as exc:
                warnings.append(f"extended H-alpha map stage failed: {exc}")
                stats["extendedMap"] = {"error": str(exc)}
        if not args.skip_pn:
            try:
                records, pn_stats = build_pn_records()
                all_records.extend(records)
                stats["planetaryNebulae"] = pn_stats
            except Exception as exc:
                warnings.append(f"planetary-nebula HASH stage failed: {exc}")
                stats["planetaryNebulae"] = {"error": str(exc)}

    if not all_records:
        raise RuntimeError("signal dataset build produced zero records")

    # Stable order and duplicate id protection.
    by_id: dict[str, dict[str, Any]] = {}
    for row in all_records:
        by_id[row["id"]] = row
    records = [by_id[k] for k in sorted(by_id)]
    stats["recordCount"] = len(records)
    stats["quantitativeRecordCount"] = sum(1 for r in records if r.get("quantitative"))
    stats["warnings"] = warnings

    dataset = {
        "schemaVersion": 1,
        "generatedAt": stats["generatedAt"],
        "catalogCommit": CATALOG_COMMIT,
        "units": {
            "halphaSurfaceBrightness": "Rayleigh",
            "oneRayleighErgCm2SArcsec2": ERG_CM2_S_ARCSEC2_PER_RAYLEIGH,
        },
        "sources": [
            {
                "id": "Finkbeiner2003-Halpha-v1.1",
                "url": HALPHA_MAP_URL,
                "description": "Composite WHAM+VTSS+SHASSA H-alpha map, 6 arcmin FWHM, HEALPix Nside=512; observed intensity, no extinction correction.",
            },
            {
                "id": "HASH-V163",
                "url": "https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/V/163?format=html&tex=true",
                "description": "HASH planetary-nebula catalogue via VizieR V/163; Galactic T/L/P objects with published H-alpha flux when available.",
            },
            {
                "id": "celestia_atlas",
                "url": f"https://github.com/acocalypso/celestia_atlas/tree/{CATALOG_COMMIT}/data",
                "description": "Pinned AstroPlanner target identity/geometry layer used to define extended-source apertures.",
            },
        ],
        "records": records,
    }
    (out_dir / "target-signal-data.json").write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (out_dir / "signal-data-audit.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_audit_markdown(out_dir / "signal-data-audit.md", stats, records, warnings)

    print(json.dumps({"records": len(records), "quantitative": stats["quantitativeRecordCount"], "warnings": warnings}, ensure_ascii=False))
    # Partial source outage is allowed if at least one stage produced data; audit makes it explicit.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
