# Production-readiness defect log

Date: July 25, 2026

All reproduction evidence was collected against a locally built production
bundle or the repository's baseline verification commands. No production system
or sensitive data was accessed.

## Findings

| ID      | Severity | Defect and reproduction evidence                                                                                                                                                                                                                                    | Shared cause / dependency                                                                                                              | Fix and regression                                                                                                                                                                                                                               |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BUG-001 | P1       | `npm run test:e2e` timed out after 120,000 ms before running a test. `package.json` served port 20073 while Playwright waited on 3000.                                                                                                                              | Runtime and test configuration drifted after the local port change.                                                                    | Preview, README, and Playwright now use 20073; E2E builds then serves the production bundle. Full-suite result is recorded below.                                                                                                                |
| BUG-002 | P1       | Open search to show landmarks, type `zzzzzz`, and press Enter inside the 260 ms debounce. The input changed to “Downtown Nashville,” proving a stale suggestion was selected for a new query.                                                                       | Asynchronous search state did not invalidate prior results synchronously.                                                              | Query change clears results and marks searching immediately; submit is disabled while pending. Covered by `inventory.spec.ts`.                                                                                                                   |
| BUG-003 | P2       | With search open, Escape left `aria-expanded="true"`; clicking Reset also left it open. The visible `/` key hint did not focus search.                                                                                                                              | Search did not own its complete open/focus/keyboard lifecycle.                                                                         | Added `/`, listbox arrow navigation, Escape, blur dismissal, 120-character cap, and background-shortcut suppression. Covered by `inventory.spec.ts`.                                                                                             |
| BUG-004 | P2       | After opening Controls, focus remained on “Open map controls”; Tab moved to the background “Face north” button. Mode key `4` could change the map behind the modal.                                                                                                 | The page toggled modal visuals without modal focus ownership.                                                                          | Modal now focuses Close, traps Tab/Shift+Tab, stops background keys, closes by Escape/backdrop, and restores opener focus. Covered by `inventory.spec.ts`.                                                                                       |
| BUG-005 | P2       | At 800 by 900 the desktop guard was visible, but search and Reset were also reported visible and interactive behind it.                                                                                                                                             | The guard used only a high z-index overlay.                                                                                            | All desktop controls are in a responsive wrapper that is `display:none` below width 960 or height 621. Boundary cases are covered by `inventory.spec.ts`.                                                                                        |
| BUG-006 | P2       | With `navigator.clipboard.writeText` rejecting, Copy map link produced page error `clipboard denied` and no status message.                                                                                                                                         | Fire-and-forget clipboard promise had no failure path.                                                                                 | Copy is guarded and failure gives address-bar instructions through an assertive error alert, while successful copying retains polite status semantics. Covered by `inventory.spec.ts`.                                                           |
| BUG-007 | P2       | Navigating to `/not-a-route` returned HTTP 404 with only `Not Found` and zero links.                                                                                                                                                                                | Root route relied on the framework's bare default 404.                                                                                 | Added branded root `notFoundComponent` and a typed link to the county map. Covered by `inventory.spec.ts`.                                                                                                                                       |
| BUG-008 | P2       | A failed `.fgb` request exposed a low-level worker message and retained `activeShardKey`, so the same view could not retry.                                                                                                                                         | Worker transport failure and view-cache state were coupled.                                                                            | User-facing status is sanitized and the failed key is released so a move/zoom retries. Covered by `inventory.spec.ts`.                                                                                                                           |
| BUG-009 | P2       | Manifest HTTP/schema errors displayed raw implementation text and a local `npm run data:build` command with no user retry.                                                                                                                                          | Developer diagnostics were rendered directly in the production fatal state.                                                            | Fatal state now uses a safe explanation and reload button. Covered by `inventory.spec.ts`.                                                                                                                                                       |
| BUG-010 | P1       | After the massing visual journey was added, `npm run test:e2e` passed 22/23 tests but the sustained-pan gate measured 83.3298 ms average frames against the finite `<80 ms` limit. The exact production journey then passed three consecutive runs with one worker. | Three concurrent GPU-heavy Chromium workers contaminated the performance measurement; the application itself passed the isolated gate. | Playwright now uses one Chromium worker for the complete readiness campaign. Frame thresholds are unchanged, and the full production-preview suite is rerun after the fix.                                                                       |
| BUG-011 | P2       | The parcel audit checked `resolvedPath.startsWith(PUBLIC_DIRECTORY)`. A sibling such as `public-other` shares that string prefix, so the boundary assertion could accept an outside path before file loading.                                                       | A semantic filesystem boundary was treated as a raw string prefix.                                                                     | Shared resolution now requires a rooted local URL and rejects empty, parent, sibling, protocol-relative, and backslash paths using `path.relative`. Covered by `parcel-utils.test.mts`; all 570 real shards still pass.                          |
| BUG-012 | P2       | A small polygon hole or narrow concavity placed between the massing fitter’s corner/edge-midpoint samples could be covered by an otherwise accepted illustrative box.                                                                                               | Finite point sampling was treated as proof that the complete rectangular footprint stayed inside the parcel polygon.                   | Candidate edges now reject outer/hole boundary intersections and boxes enclosing a hole vertex, shrinking until contained or falling back to the parcel slab. Adversarial hole/concavity regressions pass with unchanged visuals and pan budget. |
| BUG-013 | P1       | A direct geometry regression measured the first appended massing-roof normal at `-61.952…` after source Y is converted to world `-Z`. The default `FrontSide` top material therefore culled these roofs from above and roof raycasts could miss them.               | The hand-built roof indices copied the parcel-slab reversal without proving the generated rectangle’s world-space winding.             | Roofs now use `0-1-2` and `0-2-3` winding. Every appended roof triangle must have a positive world-Y normal; all six production visual baselines remain clean.                                                                                   |
| BUG-014 | P2       | For a fitted roof spanning `(20,20)` to `(60,50)` on a parcel whose bounds center was `(5,5)`, the inspector tether used `(5,5)` instead of the roof center `(40,35)`, terminating at roof height in empty air.                                                     | The spatial ownership center was also treated as the visual building anchor even when fitting deliberately moved the massing.          | A shared anchor helper averages the fitted footprint and falls back to the parcel center for slab-only groups. Helper and scene regressions cover both paths.                                                                                    |
| BUG-015 | P2       | A live Metro query for `600 CHURCH ST` rendered six repetitive destinations and exposed the provider taxonomy `StreetAddress` in each result.                                                                                                                       | Provider candidates were rendered verbatim without a product-level uniqueness or copy boundary.                                        | Address results now collapse punctuation-only duplicates, translate service types into plain language, and announce searching/result counts. Unit and production-browser regressions reproduce the provider response.                            |
| BUG-016 | P2       | A live 1440×900 type audit found 15 of 26 visible text-bearing elements below 10 px, including legend data, provider attribution, status, parcel disclaimers, and zoom guidance.                                                                                    | The initial density target let persistent civic data and operating guidance use decorative micro-type sizing.                          | Persistent information now has a 10 px floor, compact 960×621 composition has a visual baseline, camera icons expose hover/focus labels, and the compact provider chip retains a complete accessible name.                                       |

## Shared-cause review

Ten shared causes account for the findings:

1. Configuration values were duplicated across package scripts, documentation,
   and browser configuration.
2. Visual overlay state was not treated as exclusive keyboard and focus state.
3. Asynchronous failure/pending state was reported but not always invalidated or
   made recoverable.
4. A finite performance assertion shared CPU/GPU resources with unrelated
   visual journeys, so the harness measured test contention instead of one
   production-like user session.
5. The data audit compared filesystem paths as strings instead of checking a
   path-relative containment boundary.
6. The illustrative geometry fitter sampled representative points instead of
   proving full polygon-boundary containment.
7. Appended geometry winding was inferred from a different triangulation path
   instead of asserted after the coordinate-system transform.
8. The parcel bounds center served both spatial ownership and visual anchoring,
   even though fitted geometry can intentionally move away from it.
9. Remote provider candidates and taxonomies crossed into the interface without
   product-level normalization.
10. Visual density was optimized before a minimum persistent-information type
    scale was enforced.

The fixes therefore centralize the port in executable scripts, give each overlay
ownership of its lifecycle, clear or release stale async state before a new
action can consume it, and isolate the browser campaign to one WebGL renderer
without weakening the performance budget. The public-data audit now resolves
asset paths through one tested containment helper.
Illustrative massing now applies the same principle to polygon rings: edge
intersection and enclosed-hole checks supplement point sampling.
Massing roof orientation is asserted in final world coordinates, and the
inspector tether now follows the fitted roof rather than the ownership center.
Metro results now pass through one uniqueness and human-label boundary before
they become search options.
Persistent civic data now uses a legibility floor, while compact layout and
icon-instrument labels preserve the map-first composition.

## Verification result

Status: clean local application pass.

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run check`: passed after the final readiness-document update.
- `npm run data:audit`: passed all 570 shards, 286,458 unique records,
  305,913 shard references, and 130.8 MiB of FlatGeobuf.
- `npm run test:coverage`: 25 files and 149 tests passed at 100% statements
  (2,240/2,240), branches (1,065/1,065), functions (468/468), and lines
  (2,036/2,036).
- First `npm run test:e2e`: production build passed; 22 of 23 browser journeys
  passed, with BUG-010 evidence retained before the next run replaced the
  ignored `test-results` directory.
- Isolated BUG-010 reproduction: the unchanged sustained-pan journey passed
  three consecutive production-preview runs with one worker.
- Final `npm run test:e2e`: production client and SSR builds passed, then 23 of
  23 browser journeys passed in one run: 9 risk-inventory journeys, 8
  interaction/provider/performance journeys, and 6 visual baselines.
- Compiled-client scan found zero Google API key patterns, Google server
  endpoint/session markers, or TanStack developer-tool markers.
- The campaign-owned production preview exited. A pre-existing project
  `vite dev --port 20073` process bound to `::1` was identified by command line
  and creation time and intentionally preserved.

## Handoff notes

- No production deployment was attempted.
- The current campaign did not read the local API key or call a real Google or
  Metro service; provider behavior used controlled local browser fixtures.
- `npm audit --omit=dev` reports one low-severity esbuild advisory concerning a
  locally run development server, not compiled browser runtime code.
- The full install audit reports 29 build/development advisories: 3 low, 10
  moderate, 16 high, and 0 critical. The high findings are in ESLint or
  Netlify packaging/image transitive tooling. npm offers only major-line
  changes (`eslint` 10 or a Netlify plugin change to 1.1.4), so no forced
  dependency mutation was applied.
- Vite reports one route chunk over its generic 500 kB minified warning
  threshold. It is 162.27 kB gzip and primarily contains the single-route 3D map
  stack; all parcel geometry remains separately sharded and loaded by viewport.
