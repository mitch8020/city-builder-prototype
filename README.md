# Nashville Parcel Diorama

A desktop Three.js explorer for the May 12, 2026 Metro Nashville and Davidson
County parcel snapshot. It provides address and APN search, parcel inspection,
shareable views, and four civic data maps without introducing simulation or
editing features.

The map is informational and is not survey-grade. Parcel values come from the
packaged snapshot; extrusion height, lighting, and other diorama effects are
illustrative.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:20073` in a current desktop version of Chrome or Edge.
WebGL2, a mouse, and a keyboard are required.

## Rebuild the parcel snapshot

Place the source archive beside this project, then run:

```powershell
npm run data:build -- --input ..\Parcels_view_119508443368863523.zip
```

The command streams all 286,458 records, transforms EPSG:2274 to EPSG:3857,
and writes the stable manifest at `public/data/parcels/manifest.json`. Geometry
is not simplified. The versioned FlatGeobuf shards are tracked with Git LFS.

The output manifest includes:

- the source SHA-256 checksum and snapshot date;
- exact source/projected coordinate counts;
- the shard-reference count and the de-duplicated logical record count;
- repair and warning totals;
- categorical lookups and appraisal quantiles.

Only map-facing fields are retained. Owner names, mailing addresses, legal
descriptions, and sale history are not packaged.

Audit every packaged shard without rebuilding or replacing the snapshot:

```bash
npm run data:audit
```

The audit decodes all 570 FlatGeobuf files, enforces the public field allowlist,
and reconciles byte, feature-reference, and de-duplicated record counts with the
manifest.

## Controls

| Input         | Action                 |
| ------------- | ---------------------- |
| Left drag     | Pan                    |
| Right drag    | Orbit                  |
| Mouse wheel   | Zoom                   |
| WASD / arrows | Pan                    |
| Q / E         | Rotate                 |
| Z / X         | Zoom in / out          |
| Home / End    | Tilt                   |
| Backspace     | Reset county view      |
| Escape        | Close the active panel |
| 1–4           | Change data map        |

Move the pointer against a viewport edge to edge-scroll. Keyboard shortcuts do
not run while a search field or other control is focused.

## Verification

```bash
npm run lint
npm run check
npm run data:audit
npm test
npm run test:e2e
npm run build
```

Unit coverage includes projection, sharding, geometry holes and multipolygons,
condominium grouping, camera limits, key mappings, tile math, legends,
formatting, URL state, and the generated data manifest. Playwright builds and
serves the production bundle at 1440×900, then covers the interaction shell,
search, modes, controls, failure states, and Metro service degradation.

## Architecture

- TanStack Start owns routing, URL state, and the accessible HUD.
- Direct Three.js owns the client-only perspective scene.
- A Web Worker de-duplicates visible shards, groups matching condo footprints,
  triangulates holes with Earcut, and transfers batched buffers.
- `three-mesh-bvh` accelerates parcel hover and selection.
- Metro's muted MapServer provides contextual raster tiles through a bounded
  96-texture LRU cache.
- Exact parcel shards load only at neighborhood scale; county startup uses the
  lightweight overview.

Netlify can use the existing configuration. The connected Git host must fetch
Git LFS objects before building.
