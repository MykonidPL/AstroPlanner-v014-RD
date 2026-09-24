# Third-party notices — AstroPlanner v0.14 R&D

AstroPlanner application code is licensed separately under the repository's `LICENSE`. The astronomical catalog data listed below remains subject to its own upstream licence and attribution terms.

## Aladin Lite

- Component: Aladin Lite v3 (loaded at runtime from the official CDS service)
- Developer / maintainer: Centre de Données astronomiques de Strasbourg (CDS), Université de Strasbourg / CNRS
- Project: https://github.com/cds-astro/aladin-lite
- Runtime service used by AstroPlanner: `https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js`
- License declared by the current upstream package: GNU Lesser General Public License v3.0 or later (**LGPL-3.0-or-later**)
- License text: https://github.com/cds-astro/aladin-lite/blob/master/LICENSE
- Documentation / terms of use: https://aladin.cds.unistra.fr/AladinLite/doc/

AstroPlanner uses Aladin Lite only as the browser-side HiPS raster renderer. AstroPlanner keeps its own map controls, coordinate grid, target/FOV/mosaic geometry and application data model. Aladin Lite is not bundled into this repository; it is loaded dynamically from the CDS service.

## DSS2 Color HiPS

- HiPS identifier used by AstroPlanner: `CDS/P/DSS2/color` (Aladin alias `P/DSS2/color`)
- Survey title: DSS colored / DSS2 Color
- HiPS producer: CDS (Strasbourg)
- Original survey imagery: Digitized Sky Survey, STScI/NASA; photographic material from the Oschin Schmidt Telescope at Palomar and the UK Schmidt Telescope
- HiPS copyright metadata: CNRS / Université de Strasbourg
- HiPS license metadata: Open Database License 1.0 (**ODbL-1.0**)
- Metadata / attribution record: https://alasky.cds.unistra.fr/MocServer/query?ID=CDS%2FP%2FDSS2%2Fcolor&fmt=html&get=record
- STScI DSS copyright information: https://archive.stsci.edu/dss/copyright.html

The CDS metadata states that the color HiPS is composed from DSS2 red and blue surveys generated from original scanned plates obtained from STScI, with the green channel derived from the other components. It also carries the Digitized Sky Survey acknowledgement identifying STScI and the originating Palomar/UK Schmidt photographic surveys. AstroPlanner does not redistribute DSS2 tiles; the application requests them from the external HiPS service at runtime. For project previews, AstroPlanner may keep a regenerable snapshot of the current DSS2 framing view locally on the user device in IndexedDB. This preview cache is not bundled with the repository and is not included in the JSON backup export.

## HYG star database v4.1

- Dataset: HYG v4.1
- Author / maintainer: David Nash / Astronexus
- Source: https://github.com/astronexus/HYG-Database
- Current upstream: https://codeberg.org/astronexus/hyg
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
- License text: https://creativecommons.org/licenses/by-sa/4.0/

AstroPlanner uses stellar positions and apparent magnitudes for the technical framing map. The application fetches a compact binary representation prepared by `bryancurran/celestial-cartography`:

https://github.com/bryancurran/celestial-cartography

The HYG-derived star data remains subject to CC BY-SA 4.0.

## Deep-sky catalogue layers

AstroPlanner fetches pinned, preprocessed catalogue files from the `acocalypso/celestia_atlas` data set and keeps them in a separate browser cache. The DSO renderer in AstroPlanner does not create a second catalogue; it renders the same records used by the Planner search catalogue.

Pinned data source:

https://github.com/acocalypso/celestia_atlas

### OpenNGC-derived layer

- Upstream project: OpenNGC by Mattia Verga
- Source: https://github.com/mattiaverga/OpenNGC
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
- AstroPlanner uses catalogue positions, object types and, when available in the prepared record, catalogue major/minor axes and position angle.

### Stellarium-derived DSO supplement

- Upstream project: Stellarium
- Source: https://github.com/Stellarium/stellarium
- Licence boundary of the pinned Celestia Atlas supplement: GPL-2.0-or-later
- The supplement remains separately licensed catalogue material; AstroPlanner application code is not relicensed by this notice.

### SIMBAD-derived Abell planetary-nebula layer

- Database: SIMBAD, operated at CDS, Strasbourg, France
- Source: https://simbad.cds.unistra.fr/
- Database licence: Open Database License (ODbL) 1.0
- Requested acknowledgement: this product makes use of the SIMBAD database, operated at CDS, Strasbourg, France.

The derived catalogue files retain their upstream/data-set licensing. AstroPlanner's local cache is only a delivery mechanism and does not change those terms.

## NordAPI light-pollution estimate

- Service: NordAPI — Science & Space / Light Pollution Estimate
- Endpoint used at runtime: `https://nordapi.ee/api/v1/lightpollution`
- Documentation: https://nordapi.ee/docs/science
- Authentication: no API key required for the public free endpoint at the time of integration

AstroPlanner uses this endpoint only to show a small **approximate Bortle indicator** for the latitude/longitude currently selected in the Planner. The request sends those coordinates to NordAPI when an estimate is not already present in the local cache. Results are cached locally in the browser to reduce repeated requests.

NordAPI documents this value as a population-based estimate derived from weighted nearby population within 100 km. It is **not** a satellite light-pollution measurement and is **not** an on-site SQM reading. AstroPlanner therefore presents the value as `Bortle ≈ X` and does not treat it as an exact measurement. Failure of the external service does not block Planner calculations, saved locations, GPS, projects or sessions.
