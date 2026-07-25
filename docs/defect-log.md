# Production-readiness defect log

Date: July 24, 2026

All reproduction evidence was collected against a locally built production
bundle or the repository's baseline verification commands. No production system
or sensitive data was accessed.

## Findings

| ID      | Severity | Defect and reproduction evidence                                                                                                                                                              | Shared cause / dependency                                                   | Fix and regression                                                                                                                                         |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-001 | P1       | `npm run test:e2e` timed out after 120,000 ms before running a test. `package.json` served port 20073 while Playwright waited on 3000.                                                        | Runtime and test configuration drifted after the local port change.         | Preview, README, and Playwright now use 20073; E2E builds then serves the production bundle. Full-suite result is recorded below.                          |
| BUG-002 | P1       | Open search to show landmarks, type `zzzzzz`, and press Enter inside the 260 ms debounce. The input changed to “Downtown Nashville,” proving a stale suggestion was selected for a new query. | Asynchronous search state did not invalidate prior results synchronously.   | Query change clears results and marks searching immediately; submit is disabled while pending. Covered by `inventory.spec.ts`.                             |
| BUG-003 | P2       | With search open, Escape left `aria-expanded="true"`; clicking Reset also left it open. The visible `/` key hint did not focus search.                                                        | Search did not own its complete open/focus/keyboard lifecycle.              | Added `/`, listbox arrow navigation, Escape, blur dismissal, 120-character cap, and background-shortcut suppression. Covered by `inventory.spec.ts`.       |
| BUG-004 | P2       | After opening Controls, focus remained on “Open map controls”; Tab moved to the background “Face north” button. Mode key `4` could change the map behind the modal.                           | The page toggled modal visuals without modal focus ownership.               | Modal now focuses Close, traps Tab/Shift+Tab, stops background keys, closes by Escape/backdrop, and restores opener focus. Covered by `inventory.spec.ts`. |
| BUG-005 | P2       | At 800 by 900 the desktop guard was visible, but search and Reset were also reported visible and interactive behind it.                                                                       | The guard used only a high z-index overlay.                                 | All desktop controls are in a responsive wrapper that is `display:none` below width 960 or height 621. Boundary cases are covered by `inventory.spec.ts`.  |
| BUG-006 | P2       | With `navigator.clipboard.writeText` rejecting, Copy map link produced page error `clipboard denied` and no status message.                                                                   | Fire-and-forget clipboard promise had no failure path.                      | Copy is guarded and failure gives address-bar instructions through `role="status"`. Covered by `inventory.spec.ts`.                                        |
| BUG-007 | P2       | Navigating to `/not-a-route` returned HTTP 404 with only `Not Found` and zero links.                                                                                                          | Root route relied on the framework's bare default 404.                      | Added branded root `notFoundComponent` and a typed link to the county map. Covered by `inventory.spec.ts`.                                                 |
| BUG-008 | P2       | A failed `.fgb` request exposed a low-level worker message and retained `activeShardKey`, so the same view could not retry.                                                                   | Worker transport failure and view-cache state were coupled.                 | User-facing status is sanitized and the failed key is released so a move/zoom retries. Covered by `inventory.spec.ts`.                                     |
| BUG-009 | P2       | Manifest HTTP/schema errors displayed raw implementation text and a local `npm run data:build` command with no user retry.                                                                    | Developer diagnostics were rendered directly in the production fatal state. | Fatal state now uses a safe explanation and reload button. Covered by `inventory.spec.ts`.                                                                 |

## Shared-cause review

Three causes accounted for all findings:

1. Configuration values were duplicated across package scripts, documentation,
   and browser configuration.
2. Visual overlay state was not treated as exclusive keyboard and focus state.
3. Asynchronous failure/pending state was reported but not always invalidated or
   made recoverable.

The fixes therefore centralize the port in executable scripts, give each overlay
ownership of its lifecycle, and clear or release stale async state before a new
action can consume it.

## Verification result

Status: clean local application pass.

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run check`: passed after final formatting.
- `npm run data:audit`: passed all 570 shards, 286,458 unique records,
  305,913 shard references, and 130.8 MiB of FlatGeobuf.
- `npm run test:coverage`: 23 files and 103 tests passed with 100% statements,
  branches, functions, and lines.
- `npm run test:e2e`: production build passed, then 21 browser tests passed in
  one run. The 21 include 9 risk-inventory journeys, 7 interaction/provider
  journeys, and 5 refreshed visual baselines.
- `npm run build`: client and SSR production bundles passed.
- A real-key production preview passed at county and downtown scales. Google
  roadmap tiles, current attribution, parcel geometry, modes, camera controls,
  county reset, and selection stayed aligned with zero console warnings or
  errors; all observed Google gateway requests succeeded and no
  `NashvilleBasemapMuted` request occurred.
- Compiled-client scan found no TanStack developer-tool shell markers.

## Handoff notes

- No production deployment was attempted.
- `npm audit --omit=dev` reports one low-severity esbuild advisory concerning a
  locally run Windows development server, not browser runtime code.
- The full install audit reports 18 transitive advisories: 4 low, 10 moderate,
  and 4 high. Seventeen are under Netlify development/build tooling. npm offers
  only a breaking plugin downgrade, so no forced audit mutation was applied.
- Vite reports one route chunk over its generic 500 kB minified warning
  threshold. It is 173 kB gzip and primarily contains the single-route 3D map
  stack; all parcel geometry remains separately sharded and loaded by viewport.
