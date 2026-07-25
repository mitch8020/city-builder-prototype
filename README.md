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

Create an ignored `.env` file with a Google Maps Platform key that has the Map
Tiles API enabled:

```dotenv
GOOGLE_MAPS_API_KEY=your-server-side-key
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
npm run typecheck
npm run check
npm run data:audit
npm test
npm run test:coverage
npm run test:e2e
npm run build
```

`test:coverage` enforces 100% statement, branch, function, and line coverage for
the hand-authored application source under `src` plus `scripts/parcel-utils.mjs`.
The generated TanStack route tree is excluded. Playwright builds and serves the
production bundle at 1440×900, then covers the interaction shell, search,
modes, controls, failure states, and Metro service degradation.

## Architecture

- TanStack Start owns routing and URL state. Focused React hooks own manifest
  loading and the debounced Nashville search lifecycle, while HUD components
  stay presentational.
- `CityMap` is the React-to-Three.js adapter. `NashvilleScene` coordinates the
  renderer, viewport geometry, raycasting, selection, and status callbacks.
- `MapInteractions` owns DOM input listeners and gesture state; `CameraRig`
  owns camera controls, limits, navigation, and animation.
  `MapViewportScheduler` coalesces parcel/tile updates and samples view velocity.
- `ParcelLoadPlanner` is the pure predictive prefetch and queue-priority policy.
  `ParcelStream` owns worker execution, cancellation, generations, retry, cache,
  visibility, and coverage. The worker groups condo footprints and triangulates
  exact polygons; `ParcelLayer` owns GPU buffers, BVH picking, colors, and
  selection rendering.
- `GoogleTileManager` owns Google roadmap tiles through a bounded 96-texture
  LRU cache and shows them only with Google’s current viewport attribution.
- Narrow TanStack routes use a stable server facade over separate request
  validation, session/upstream transport, and local HTTP adapters.
  `web-mercator.ts` supplies the shared browser/server projection math, and the
  server-only gateway keeps `GOOGLE_MAPS_API_KEY` out of the browser bundle.
- Exact parcel shards load only at neighborhood scale; county startup uses the
  lightweight overview.

Netlify can use the existing configuration. Set `GOOGLE_MAPS_API_KEY` in the
hosting environment, restrict it to the Map Tiles API, and configure an
appropriate quota cap and billing alert. The connected Git host must fetch Git
LFS objects before building.
