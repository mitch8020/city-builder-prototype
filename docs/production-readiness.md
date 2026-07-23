# Local production-readiness inventory

Date: July 23, 2026

## Scope and safety boundary

This campaign covers the local Nashville Parcel Diorama and its packaged May 12,
2026 parcel snapshot. It does not access an authenticated account, production
deployment, private database, or real user record.

The only application role is an anonymous desktop explorer. There are no login,
authorization, editing, administrative, or destructive user workflows.

The packaged snapshot is production scale:

- 286,458 de-duplicated parcel records;
- 305,913 spatial-shard references;
- 570 FlatGeobuf shard files;
- approximately 130.8 MiB of FlatGeobuf data;
- owner names, mailing addresses, legal descriptions, and sale history omitted;
- civic parcel address, parcel identifiers, land use, zoning, acreage, and
  appraisal fields intentionally retained.

`npm run data:audit` decodes every shard, enforces the exact public field
allowlist, verifies geometry and record IDs, and reconciles bytes and counts
against the manifest. Rebuilding was intentionally not required because the
current snapshot already matches its source checksum and rebuilding would
replace the versioned output directory.

## Production-like local settings

- `npm run test:e2e` builds the production client and SSR bundles first.
- Playwright serves the built bundle with `vite preview` on
  `http://127.0.0.1:20073`.
- Chromium runs at the supported desktop size of 1440 by 900.
- Remote Metro responses are controlled per test; local parcel files remain the
  real production-scale package.
- Failure artifacts retain Playwright traces and screenshots.
- TanStack developer tooling remains a development dependency and is stripped
  from production builds by the first Vite plugin.

## Route and role inventory

| ID   | Role               | Route/state                            | Acceptance criteria                                                                                                                     | Risk-based edge cases                                                                                                    |
| ---- | ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| R-01 | Anonymous explorer | `/`                                    | Returns the titled map shell, validates URL state, loads the packaged manifest, and creates a WebGL2 canvas at supported desktop sizes. | Invalid mode falls back to overview; empty, negative, fractional, or oversized identifiers are discarded.                |
| R-02 | Anonymous explorer | `/?mode=overview`                      | Shows the county overview and preserves valid mode state in the URL.                                                                    | Reload and direct navigation remain stable.                                                                              |
| R-03 | Anonymous explorer | `/?mode=landUse`, `zoning`, or `value` | Restores the requested legend and parcel color mode.                                                                                    | Mode changes preserve a selected parcel's URL fields.                                                                    |
| R-04 | Anonymous explorer | Shared parcel URL                      | Resolves `parcel` or `parId`, flies to the result, selects the intended record, and restores condominium state after reload.            | Missing remote result and unavailable Metro service show a finite toast; malformed identifiers do not start restoration. |
| R-05 | Anonymous explorer | Unmatched path                         | Returns HTTP 404 with a branded explanation and a working link to `/`.                                                                  | Incomplete and stale shared paths do not strand the user.                                                                |

## User-facing feature and control inventory

| ID    | Feature, control, or state                                    | Acceptance criteria                                                                                                            | Finite edge cases                                                                      |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| UI-01 | Initial loading state                                         | “Preparing Nashville's parcel fabric” is visible until the manifest and client scene are ready.                                | Slow manifest; SSR-to-client handoff.                                                  |
| UI-02 | Desktop-size guard                                            | At width 959 or less, or height 620 or less, the guard is the only interactive experience. At 960 by 621 the map is available. | Exact width and height boundaries; resize in both directions.                          |
| UI-03 | WebGL2 unsupported state                                      | Explains the requirement and links to the Metro Parcel Viewer.                                                                 | `getContext('webgl2')` returns null.                                                   |
| UI-04 | Manifest failure state and retry button                       | Uses a safe, non-technical message and exposes “Try loading the map again.”                                                    | HTTP failure, invalid JSON, schema mismatch, wrong record count.                       |
| UI-05 | Brand and source date                                         | Shows Nashville Parcel Diorama, Metro/Davidson attribution, and May 12, 2026 snapshot date.                                    | Source date is interpreted in UTC.                                                     |
| UI-06 | Network pill                                                  | Shows “Metro context” when tiles work and “Local map” when the remote basemap fails.                                           | Partial and complete Metro outage; local parcel controls remain usable.                |
| UI-07 | Search input and `/` shortcut                                 | `/` focuses the 120-character combobox, opens suggestions, and never triggers while another input is focused.                  | Empty, one-character, maximum-length, and remote query.                                |
| UI-08 | Search result list                                            | Exposes a named listbox; Up/Down moves through options; Enter selects a current non-pending result.                            | No results, search in progress, stale prior suggestions, rapid query replacement.      |
| UI-09 | Search dismissal                                              | Escape and focus leaving the search close only the result panel.                                                               | Escape from input or option; click a camera button; selected parcel remains open.      |
| UI-10 | Search offline toast                                          | A Metro search failure shows “Metro search is offline. Landmark jumps still work.”                                             | Request abort from a superseded query is silent; landmarks remain selectable.          |
| UI-11 | Open-controls button                                          | Closes search and opens exactly one modal.                                                                                     | Search already open; repeated activation.                                              |
| UI-12 | Controls modal: close button, backdrop, Escape, Return button | Focus moves to Close, remains trapped in the modal, background shortcuts are blocked, and focus returns to the opener.         | Shift+Tab wrap, Tab wrap, Escape, backdrop click, mode key while open.                 |
| UI-13 | Overview mode button / key `1`                                | Marks Overview pressed, updates URL and legend.                                                                                | Search or modal focus suppresses shortcut.                                             |
| UI-14 | Land-use mode button / key `2`                                | Marks Land use pressed, updates URL and legend.                                                                                | Missing land-use values use the unavailable color.                                     |
| UI-15 | Zoning mode button / key `3`                                  | Marks Zoning pressed, updates URL and legend.                                                                                  | Missing zoning values use the unavailable color.                                       |
| UI-16 | Value mode button / key `4`                                   | Marks Value pressed and shows five appraisal quantiles.                                                                        | Negative/missing appraisal uses the unavailable color; exact cut points remain stable. |
| UI-17 | Face-north button                                             | Rotates the camera without changing target or throwing.                                                                        | Already north; minimum zoom.                                                           |
| UI-18 | Zoom-in and Zoom-out buttons                                  | Change distance within camera limits and trigger data-window refresh.                                                          | Repeated clicks clamp at minimum/maximum.                                              |
| UI-19 | Tilt-up and Tilt-down buttons                                 | Change polar angle within supported limits.                                                                                    | Repeated clicks clamp at 24 and 72 degrees.                                            |
| UI-20 | Reset-county-view button / Backspace                          | Returns to the county target and clears a pending selection fly-to.                                                            | Browser navigation is not triggered.                                                   |
| UI-21 | Canvas mouse input                                            | Left drag pans, right drag orbits, wheel zooms, pointer edge scrolls, and a short click selects.                               | A drag over five pixels does not select; leaving the canvas stops edge pan and hover.  |
| UI-22 | Canvas movement keys                                          | WASD/arrows pan, Q/E rotate, Z/X zoom, and Home/End tilt.                                                                      | Input and modal focus suppress movement; key release clears held state.                |
| UI-23 | Zoom invitation button                                        | At county scale, flies downtown and begins loading exact parcel shards.                                                        | Remote basemap may be offline; local shard loading still proceeds.                     |
| UI-24 | Legend panel                                                  | Label, description, swatches, and illustrative-height disclaimer match active mode.                                            | Six-category limit for categorical modes and five fixed value buckets.                 |
| UI-25 | Hover card                                                    | At neighborhood scale, pointer hover shows address and mode-specific detail only when no inspector is open.                    | Missing address/value; integrated-GPU polygon fallback.                                |
| UI-26 | Parcel inspector and close button                             | Focus moves to Close; profile, zoning, ID, area, appraisal split, and survey disclaimer match the selected record.             | Missing optional fields render “Not available”; Escape or Close clears URL selection.  |
| UI-27 | Previous/Next condominium buttons                             | Appear only for a multi-record footprint, wrap in both directions, and update parcel, `parId`, and floor URL fields.           | First-to-last and last-to-first wrap; selected record missing after a shard refresh.   |
| UI-28 | Copy-map-link button and toast                                | Clipboard success shows “Parcel link copied.” Denial shows address-bar instructions without an unhandled error.                | Missing Clipboard API; rejected permission.                                            |
| UI-29 | Metro-details link                                            | Opens a new tab with an encoded parcel ID and `rel="noreferrer"`.                                                              | Empty parcel identifier remains safely encoded.                                        |
| UI-30 | Survey tether                                                 | Connects a selected parcel to its inspector while the projected anchor is finite.                                              | Camera motion throttles anchor updates; cleared selection removes it.                  |
| UI-31 | Footer status                                                 | Announces county, loading, visible-footprint, retryable shard-error, and graphics-context-lost states.                         | Shard failure permits retry after a map movement; raw worker details are not shown.    |
| UI-32 | Toast state                                                   | Status text is exposed with `role="status"` and clears after 3.6 seconds.                                                      | Consecutive messages replace the prior message.                                        |

## Workflow acceptance inventory

| ID    | Workflow                        | Acceptance criteria                                                                                   | Regression evidence                                                 |
| ----- | ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| WF-01 | Start at county overview        | Production bundle loads real manifest and overview; all persistent controls are enabled.              | `inventory.spec.ts`, `map.spec.ts`, county visual snapshot          |
| WF-02 | Change and restore data maps    | Buttons and keys update URL, pressed state, legend, and parcel colors.                                | `map.spec.ts`, zoning/value visual snapshots                        |
| WF-03 | Search a landmark               | `/` or focus opens suggestions; selection closes results and flies locally.                           | `inventory.spec.ts`, `map.spec.ts`                                  |
| WF-04 | Search an address or APN        | Debounced Metro result selects the matching packaged parcel; stale results cannot submit.             | `inventory.spec.ts`, `map.spec.ts`                                  |
| WF-05 | Inspect and share a condominium | Select, cycle, copy, reload, and close retain the correct unit and accessible focus.                  | `inventory.spec.ts`, `map.spec.ts`, selected-parcel visual snapshot |
| WF-06 | Navigate the map                | Camera buttons, documented keyboard mappings, mouse mappings, and county reset remain bounded.        | `inventory.spec.ts`, camera unit tests                              |
| WF-07 | Work without Metro services     | Local map, modes, landmarks, and camera controls remain available with explicit offline state.        | `map.spec.ts`, offline visual snapshot                              |
| WF-08 | Recover from local data failure | Manifest failure offers reload; shard failure explains a move/zoom retry; WebGL failure offers Metro. | `inventory.spec.ts`                                                 |
| WF-09 | Use an unsupported viewport     | Guard is exclusive below either threshold and map controls return after resize.                       | `inventory.spec.ts`                                                 |
| WF-10 | Follow an invalid route or URL  | Invalid state falls back safely; unmatched path provides a 404 return link.                           | `inventory.spec.ts`, validation unit tests                          |

## Clean-pass commands

```bash
npm run lint
npm run check
npm run data:audit
npm test
npm run test:e2e
npm run build
```

The final result and exact pass counts are recorded in `defect-log.md`.
