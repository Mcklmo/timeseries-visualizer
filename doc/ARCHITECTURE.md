# Activity Visualiser — Architecture Spec

> **Audience:** an implementing coding agent (or human) working from an empty Vite project.
> **Status:** implementation in progress — see checklist below.
> **Scope of v1:** running, cycling and generic GPS tracks, metric units only, TCX/FIT/GPX file input, stacked synced charts, statistic reference lines.

---

## 0. Implementation progress

Kept in sync after each feature lands — see build order in §11.

- [x] Test infra: vitest + React Testing Library, jsdom, `ResizeObserver` stub for Recharts
- [x] `domain/types.js` — JSDoc typedefs (Sample, Activity, RawTrackpoint)
- [x] `domain/units.js` — `formatPace`, `formatDuration`, `formatDistanceKm`, `mpsToSecPerKm` (TDD)
- [x] `stats/aggregate.js` — avg/max/median per `aggStrategy` (TDD). **Verified early:** avg pace = `totalMovingTime / totalDistance`, proven against a hand-computed case to differ from naive mean-of-instantaneous-pace by ~18%. `max` is invertAxis-aware (pace's "max" = fastest, i.e. numeric min).
- [x] `data/ActivitySource.js` port + `fixtures/sample-run.json` + `MockActivitySource` (TDD)
- [x] `metrics/metricRegistry.js`
- [x] `stats/useMetricStats.js` (TDD memoized hook)
- [x] `data/ActivitySource.js` — `ActivitySourceProvider`/`useActivitySource` DI context (TDD). **Fixed along the way:** `@testing-library/react`'s auto-cleanup needs a global `afterEach`, which this project doesn't have (`globals: false`); without it, DOM leaked across tests in the same file. `setupTests.js` now calls `afterEach(cleanup)` explicitly — applies to all future test files, not just this one.
- [x] `state/ActivityContext.jsx` — `activity`/`status`/`error`/`load(ref)`, backed by the injected `ActivitySource` (TDD)
- [x] `state/ChartViewContext.jsx` — `xMode`/`zoomDomain`/`enabledMetrics`/`enabledStats`/`hoverIndex` + setters (TDD). `enabledMetrics` is always re-sorted to canonical `metricOrder` on toggle, regardless of toggle sequence, so anything iterating it directly gets a stable order.
- [x] `app/providers.jsx` — `AppProviders({ source, children })` composing all three (TDD)
- [x] `ui/SyncedTooltip.jsx` — Recharts `<Tooltip content>` shared by every panel; header always shows elapsed time *and* distance regardless of `xMode`, body shows that panel's metric label/value/unit. Built now (ahead of its own build-order slot) because a panel needs *some* Tooltip for Recharts to render a crosshair at all — see next item.
- [x] `ui/MetricPanel.jsx` + `ui/ChartStack.jsx` — hardcoded via `ChartViewContext`'s default `enabledMetrics` (all of `metricOrder`, since `ControlPanel` doesn't exist yet to change it); `ChartStack` filters `metricOrder` by `activity.availableMetrics ∩ enabledMetrics`, first panel 200px / rest 140px, only the bottom panel shows axis ticks. Axis alignment and syncId crosshair sync are verified against real rendered Recharts SVG output in jsdom (parsed path/line pixel coordinates), not just component props. **Two jsdom pitfalls cost real debugging time:** (1) `ResponsiveContainer` measures its container via `getBoundingClientRect()` on mount; jsdom's is always all-zero, so every chart rendered at 0×0 with no children at all until `setupTests.js` got a global fixed-rect stub (800×200). (2) Recharts' default axis `interval="preserveEnd"` decides which ticks to keep using real text-length measurement, which jsdom can't do reliably — it was silently collapsing every axis to a single (often out-of-range-looking) tick. Fixed with `interval={0}` on both axes, which is a reasonable production default too since `tickCount` already caps how many "nice" ticks get generated. (3) Recharts schedules mouse-move handling via `requestAnimationFrame`, not synchronously — crosshair-sync tests must `fireEvent.mouseMove` then `await` a couple of rAF ticks before asserting on `.recharts-tooltip-cursor`.
- [x] `ui/ControlPanel.jsx` + `MetricToggle` + `StatCheckboxes` + `XAxisModeSwitch` (TDD, system test). Reads `activity.availableMetrics` directly, so it never offers a control for a metric the loaded activity has no data for — mirrors the filter `ChartStack` already applies. `MetricToggle`'s accessible name is just the metric label (e.g. "Cadence"); `StatCheckboxes` needed an explicit `aria-label` per input (`"Cadence max"`) because three plain "max"/"avg"/"median" checkboxes recur once per metric row and would otherwise collide under the same accessible name. Verified end-to-end against real rendered Recharts output (not just context state): unchecking a metric toggle removes that panel from `ChartStack`, checking a stat checkbox adds a `.recharts-reference-line` to the right panel only, and flipping the x-axis-mode switch changes the bottom panel's tick values from elapsed seconds to metres.
- [x] `Brush` + controlled `zoomDomain` wired across all panels (TDD, system test). Only the bottom panel renders the `Brush`; its `onChange` writes `zoomDomain` via `ChartViewContext`, which every panel's `XAxis domain` already read. **Non-obvious Recharts wrinkle:** `Brush` also tracks its own selected sample-index range internally (independent of our `zoomDomain`), and that index range — not literally `'dataMin'/'dataMax'` over the full sample array — is what those sentinels resolve against for every synced panel. Left uncontrolled, the Brush's index selection survives an `xMode` switch even after our `zoomDomain` context resets to `['dataMin','dataMax']`, silently re-narrowing "full" to whatever was last brushed (e.g. distance axis clipped to 0–100m instead of 0–200m after zooming in time mode then switching to distance). Fixed by making `Brush` a controlled component: `startIndex`/`endIndex` are derived from `zoomDomain` each render, so a context reset now also resets the Brush's own selection. Verified by simulating a real Recharts drag (`fireEvent.mousedown` on `.recharts-brush-traveller`, then `mousemove`/`mouseup` on `window`, since Brush's drag handlers are attached to `window`, not the traveller) — jsdom's `MouseEvent.pageX` is a getter that just returns `clientX` (no scroll-offset support), so the drag delta must be sent as `clientX` or Brush's internal math sees zero movement. Also discovered empirically: Recharts drops out-of-domain samples entirely from the line path on zoom (`M`/`L` point count shrinks) rather than clamping their pixel position to the plot edge — the system test asserts on point count for that reason, not on the pixel position of a specific sample.
- [x] `ui/FileDropZone.jsx` (TDD) — click-to-browse (hidden `<input type="file">` behind a `<label>`) + real drag-and-drop (`dragenter`/`dragover`/`drop`), hands a raw `File` up via `onFileSelected` and does no parsing itself, per the dependency rule in §3. Tracks its own `isDragActive` for a visual affordance, cleared on both `dragleave` and `drop`.
- [x] `ui/EmptyState.jsx` + `ui/ErrorState.jsx` (TDD) — `EmptyState` composes `FileDropZone` with a "Load sample activity" button (`onFileSelected` / `onLoadSample`) so the UI is explorable without a real TCX export on hand; `ErrorState` surfaces `error.message` directly (adapters throw specific reasons) behind `role="alert"` with a "Try again" button.
- [x] `App.jsx` wired end-to-end against `MockActivitySource` (TDD, system test). Exports `AppShell` (reads `ActivityContext`/renders by `status`) separately from the default-exported `App` (`AppShell` wrapped in `AppProviders` with a real `MockActivitySource` instance) — mirrors how every other UI test in this repo drives a component through `AppProviders` with a source double, and lets `App.test.jsx` cover `loading`/`error`/retry paths the real Mock can never produce (it always resolves). `AppShell` keeps the last-attempted `ActivityRef` in a `ref` so `ErrorState`'s "Try again" replays the exact same `load()` call rather than only ever falling back to the sample. Verified end-to-end against real rendered Recharts output, same as every other UI item above: idle → `EmptyState` → click "Load sample activity" or drop a file → `ControlPanel` + `ChartStack` render with real synced panels. Applied the §9 dark-theme tokens (`styles/tokens.css`, `styles/global.css`) and removed the leftover default-Vite-template files (`App.css`, `index.css`, `assets/{hero.png,react.svg,vite.svg}`) that weren't part of the folder scaffold in §4. **Verification gap, logged for transparency:** this sandbox has no headless-browser tooling (no `chromium-cli`/Playwright installed) and no Accessibility permission for AppleScript UI-scripting, so only the empty state was confirmed against a real rendered screenshot (Safari, `localhost` dev server) — the loaded-chart view was *not* independently screenshotted by the agent. The interactive flow's correctness rests on the system test above (real Recharts SVG assertions) plus a manual walkthrough handed to the user to click through themselves.
- [x] `domain/smooth.js`, `domain/buildDistanceAxis.js`, `domain/deriveSpeed.js`, `domain/detectPauses.js` (all TDD). `buildDistanceAxis` clamps any decrease/reset to the previous value and holds forward through a missing sample; falls back to haversine-over-lat/lon cumulative distance only when `DistanceMeters` is absent from *every* trackpoint (not per-sample — a file with occasional gaps in an otherwise-present field holds-forward instead, since "absent entirely" per §8 is a whole-file condition). `deriveSpeed` only reconstructs speed from distance/time deltas when the file has **no** sensor speed anywhere; when it does, per-sample nulls are passed through as-is rather than backfilled from the derived path, so a partially-instrumented file doesn't silently mix real and synthetic speed. `detectPauses` implements both §8 triggers (gap > 10s, sustained speed < 0.3 m/s for > 10s) as independent passes over the sample array.
- [x] `domain/normalizeActivity.js` — the pipeline entry point (TDD). Drops trackpoints that carry only a timestamp and nothing else (judged on the raw adapter fields, before any derivation), then runs `buildDistanceAxis` → `deriveSpeed` → `detectPauses` and assembles `Sample[]`. `availableMetrics` is computed here directly from which sample fields actually have data (not via `metricRegistry`, to keep `domain/` free of a dependency on the `metrics/` layer above it — see §3 dependency rule) — pace is "available" whenever any sample has `speed`, since pace is always derived at display time, never stored.
- [x] `data/tcx/parseTcx.js` (TDD) — namespace-aware (`getElementsByTagNameNS`, both the TCX and `ActivityExtension/v2` namespaces, prefix-independent), flattens every `Lap > Track > Trackpoint` under the `Activity` into one array (laps aren't surfaced yet, per §12). Doubles `TPX > RunCadence` (strides/min) into steps/min; ignores the top-level bike `<Cadence>`. Throws a specific, user-facing `Error` (shown verbatim by `ErrorState`) for: invalid XML, no `Activity` element, a non-`Running` `Sport` attribute (v1 is running-only — silently mislabeling a bike file would corrupt the cadence math), and zero usable trackpoints. Deliberately does **not** drop time-only trackpoints itself — that's `normalizeActivity`'s call, per the dependency rule that adapters do field-mapping only, never interpretation; a test locks in that layering so it can't silently drift.
- [x] `data/tcx/TcxActivitySource.js` (TDD) — `File.text()` → `parseTcx` → `normalizeActivity`, the last two of which now do the real work `MockActivitySource` always skipped. Rejects a non-`file` ref rather than silently no-op'ing.
- [x] **Real Garmin cross-check, unblocked** — user supplied a real 30-minute Garmin TCX export (`fixtures/activity_23870166877.tcx`, 1801 trackpoints, ~1 Hz) plus its Garmin-reported stats (`fixtures/activity_23870166877-meta.json`): 4.71 km, 30:00, avg pace 6:22/km. A dedicated integration test (`TcxActivitySource.realGarminFixture.test.js`) parses the real file end-to-end and asserts computed avg pace against Garmin's reported value — **matches to the second** (computed 6:22.06/km vs. reported 6:22/km), the strongest evidence yet that the `weightedPace` strategy (§6) is correct, not just internally consistent. This file also has no `<Watts>` anywhere, which incidentally covers the "at least one missing metric" case §11 step 8 asked for — `availableMetrics` correctly omits `power` and `ControlPanel` renders no toggle for it. It has **no gaps or sub-0.3 m/s stretches** (checked with a one-off script before writing tests), so `detectPauses`'s two trigger paths are verified only by synthetic unit tests, not against this real file — worth re-running the cross-check if a Garmin export containing an actual pause becomes available.
- [x] `App.jsx` composition root now dispatches by `ActivityRef` shape instead of injecting a single adapter instance: a `{type:'file'}` ref (drag-drop or browse) goes to `TcxActivitySource`, a `{type:'id'}` ref (the "Load sample activity" button) still goes to `MockActivitySource`. Both concrete adapters are instantiated in exactly one place (`App.jsx`); no other file imports either. This is a small deviation from §5's "swap the source instance, nothing else changes" framing — that framing assumed one adapter per app, but the sample-activity convenience button needs the mock fixture to keep working *alongside* real parsing, not instead of it. `App.test.jsx`'s file-drop test now exercises a real (small, hand-built) TCX string end-to-end and asserts the resulting `availableMetrics` to prove it went through the real parser, not the fixture. **Superseded 2026-08-07** (last entry in this list): the `{type:'id'}` → mock branch is gone with the sample button, so the dispatcher only picks between the two real parsers and §5's one-adapter-per-app framing holds again.
- [x] `data/fit/parseFit.js` + `data/fit/FitActivitySource.js` (TDD) — FIT (binary) parsing via `@garmin/fitsdk` (official Garmin package, zero runtime deps, pure ESM) added to recover Stryd running power, which Garmin Connect's FIT→TCX exporter silently drops (the existing `activity_23870166877.tcx` fixture has no `<Watts>` anywhere despite the run being recorded with a Stryd pod). **Non-obvious finding, verified at the byte level against the user's real FIT export (`fixtures/23870166877_ACTIVITY.fit`):** the `record` message definitions in this file don't include the standard power field at all — power exists *only* as a developer field, tied to a `developer_data_id` message whose `application_id` (`18fb2cf0-1a4b-430d-ad66-988c847421f4`) is Stryd's registered FIT app id. `@garmin/fitsdk` keys `record.developerFields` by a sequential `key` assigned during decode, not by `fieldDefinitionNumber` — resolving the right key requires matching `fieldDescriptionMesgs` by `nativeMesgNum === 20 && nativeFieldNum === 7` (i.e. "mirrors record's standard power field") first. A generic/naive FIT reader that only knows the standard profile would reproduce the exact same "no power" bug the TCX export has. See §8 for the rest of the FIT-specific parsing notes this uncovered (cadence doubling parity, semicircle lat/lon conversion, decode error shape). `parseFit` is `async` (unlike sync `parseTcx`) because `@garmin/fitsdk` (~1.3 MB, almost all of it the FIT field/message profile table) is dynamically imported *inside* it, keeping that weight out of the eager bundle for TCX-only users; `FitActivitySource` imports it normally since the file itself is tiny. `App.jsx`'s composition-root dispatcher now routes a dropped/browsed file to `FitActivitySource` or `TcxActivitySource` by extension (`.fit` vs `.tcx`) rather than always going to TCX. **Real Garmin FIT cross-check:** `FitActivitySource.realGarminFixture.test.js` parses the same 1801-trackpoint, 30-minute activity as the existing TCX cross-check test and matches it on distance/duration/avg pace — but where that TCX test asserts `power` is *absent* from `availableMetrics`, this one asserts the inverse: `availableMetrics` *does* contain `'power'` (avg 224 W, sane 85–270 W range), which is the actual proof the recovery works end-to-end, not just that the file parses.
- [x] **Cycling support** — widened `Sport` to `'running'|'cycling'` and wired the previously-dead `metricRegistry[id].sports` filtering into `ControlPanel`/`ChartStack` (via a new `isMetricForSport()` helper) — that field existed since the registry was first built but nothing read it until now. `parseTcx`/`parseFit` now resolve the file's actual sport (TCX `Sport="Biking"`, FIT `sessionMesgs[0].sport === 'cycling'`) instead of hard-rejecting anything but running; both branch cadence handling on it (TCX: plain top-level `<Cadence>` instead of `TPX>RunCadence`; FIT: `record.cadence` passed through undoubled) since the running-specific strides→steps doubling would silently corrupt a bike file's cadence otherwise — see §8. New `speed` metric (km/h, `metrics/metricRegistry.js`) replaces `pace` for cycling activities (`pace.sports` narrowed to `['running']`, `speed.sports` is `['cycling']`) — average speed uses `movingOnly` rather than `weightedPace`, since (unlike pace) average speed *is* the time-weighted mean of instantaneous speed by definition, so the reciprocal-avoidance strategy pace needs doesn't apply. Deliberately reuses `--metric-pace` as `speed`'s line color rather than adding a new CSS token, since the two are mutually exclusive per activity and never render together. `cadence.unit` became the registry's first sport-dependent field (`(sport) => sport==='cycling'?'rpm':'spm'`), resolved via a new `metricUnit()` helper everywhere `metric.unit` used to be read directly (`MetricPanel`'s `StatLabels`/`Tooltip`, `SyncedTooltip`) — both now take a `sport` prop threaded down from `activity.sport`. `normalizeActivity`'s `availableMetricsOf` stays sport-agnostic by design (per its existing comment) — it flags both `'pace'` and `'speed'` as available whenever sample speed data exists; sport-based visibility is entirely a UI-layer concern.
- [x] **Inferred workout name + sport chip** — added `Activity.name` (§5), computed in `normalizeActivity` by the new `domain/deriveWorkoutName.js` (TDD) from a time-of-day bucket (viewer's local browser time, i.e. `Date.prototype.getHours()`, not UTC — neither file format carries a timezone offset, and this is usually close enough since people tend to view an activity from roughly where they recorded it) plus a sport label. FIT's `sportLabel` (see §8) is used when present (e.g. "Morning Trail Run"); TCX and profile-less FIT files fall back to a generic `'running'`/`'cycling'` → `"Run"`/`"Ride"` map (e.g. "Morning Run") — so FIT and TCX exports of the *same* activity can get different names. New `ui/ActivityHeader.jsx` renders the name plus a separate, stable sport chip ("Running"/"Cycling", i.e. `activity.sport` capitalized) — deliberately **not** `sportLabel` again, which would just duplicate the name; the chip is the broad classification that also drives unit conventions elsewhere (spm vs rpm), the name is the specific, richer title.
- [x] **Cadence Y-axis zoom** — `stats/aggregate.js` gained `computeYDomain()`, which wires up the previously-dead `domainPadding` field (§6) into a real per-metric `<YAxis domain>` in `MetricPanel.jsx`, reusing the same `movingOnly` exclusion `extreme()`/`timeWeightedMean()` already use for stat lines so paused zero-cadence samples (`sample.moving === false`) stop dragging the computed min down to 0 and Recharts' "nice tick" rounding stops inflating the max to 220. Enabled for `cadence` (`domainPadding: 0.08`, matching `pace`/`speed`); `pace` and `speed` pick up the behavior for free since they already declared the field with nothing reading it. `heartRate`/`power`/`altitude` are untouched (no `domainPadding` → `computeYDomain` returns `undefined` → Recharts' current auto-domain, unchanged). **Non-obvious Recharts wrinkle:** an explicit `domain` alone was not enough — `<YAxis>`'s default `allowDataOverflow={false}` silently re-expands any explicit domain to cover *every* plotted data point, including the excluded-from-the-domain-calc paused `cadence: 0` samples (they're still in `data`, just skipped when computing `yDomain`), which snapped the axis straight back to ~0 in testing. Fixed with `allowDataOverflow={yDomain != null}` — only clips for metrics that opted into an explicit domain, so `heartRate`/`power`/`altitude` (still `domain={undefined}`) keep their exact prior auto-domain behavior.
- [x] **2026-08-07: stat labels moved below the chart** — `MetricPanel` reserved a fixed 200px right margin (`LineChart margin.right`) to fit avg/max/median labels as SVG `<text>` positioned at each stat's real y-value, decluttered vertically (`declutter`/`STAT_LABEL_GAP`/`MIN_STAT_LABEL_SPACING`) so close values (e.g. avg ≈ median) didn't overlap. On mobile that column ate a large share of viewport width, leaving little room for the plotted line itself. Fixed by shrinking `margin.right` to `12` and rendering the same text (`StatSummary`, a plain-HTML flex row of `.stat-chip`s) below the chart, outside the SVG — a flex row can't overlap, so the decluttering machinery (`StatLabels`/`declutter`/`STAT_LABEL_GAP`/`MIN_STAT_LABEL_SPACING`) was deleted outright rather than ported. `<ReferenceLine>`s are unchanged (still show the horizontal indicator); only the label moved. No show/hide toggle was added — chips are unconditional, same as the reference lines they annotate. The `.metric-panel` wrapper kept the old fixed pixel `height` from `ChartStack` (still driving `<ResponsiveContainer height>` for the chart itself), which left `.stat-summary` no room of its own — it overflowed the wrapper's bottom edge and painted over the next panel down. Fixed by switching the wrapper to `minHeight` instead of `height`: the chart keeps its exact prior height, but the box now grows to fit the chip row (single or wrapped) rather than clipping it.
- [x] **2026-08-07: added a `min` stat** — mirrors `max` rather than always being the literal numeric minimum: decided with the product owner that `min` is the *opposite* extreme from `max` on each metric's own (possibly inverted) axis, not literally "smallest number." For ordinary metrics this is identical to the literal minimum (`invertAxis: false`), but for `pace` (`invertAxis: true`) it's the slowest/worst moment — numerically the *largest* s/km — the mirror image of `max`'s fastest-moment behavior. The rejected alternative (literal numeric minimum always) would have made `min`/`max` show the identical value for pace, reading as a bug. Implemented as `extreme(samples, accessor, { invert: !invertAxis })` in `aggregate.js`, the boolean-flipped counterpart of `max`'s `invert: !!invertAxis`. Wired through `computeMetricStat`, `useMetricStats`, `StatKind`, `MetricPanel`'s `STAT_ORDER`/`STAT_DASH` (new `1 2` dash pattern), and `StatCheckboxes`' `STAT_KINDS` — all four stat-kind lists updated per the existing hardcoded-per-place pattern (no shared registry).
- [x] **2026-08-07: persistent sticky "Load an activity" bar** — the load controls (`FileDropZone` + "Load sample activity" button) used to live only in `EmptyState`, gated to `status === 'idle'`, so loading a *different* activity after one was already loaded (or after landing on `ErrorState`) meant fixing/retrying from the error screen or reloading the page. `EmptyState.jsx` is now `ui/LoadActivityBar.jsx` — controls-only, no heading/"or" separator — rendered unconditionally in `AppShell`'s `<header>` next to the `<h1>`, outside the `status` switch, so it's visible and usable across idle/loading/error/ready. `.app-header` became `position: sticky; top: 0` (the first sticky/`z-index` usage in the codebase) with an opaque `background: var(--bg)` so scrolled content doesn't show through, plus a flex-row layout (`flex-wrap: wrap`) so the bar drops under the title on narrow viewports without extra markup. `FileDropZone`'s label copy and `.file-drop-zone` styling shrank from a tall dashed drop card to an inline compact control to fit the header row.
- [x] **2026-08-07: feedback → GitHub issue, and with it the project's first server-side code.** A "Feedback" trigger in a new persistent `<footer>` (outside the `status` switch, like the header — someone staring at an error is exactly who most needs to report it) opens a native `<dialog>`; submitting `POST /api/feedback` files a labelled issue on `Mcklmo/timeseries-visualizer`. This breaks §1's "no server-side anything" non-goal *for this one route only* — the activity pipeline is untouched and still runs entirely client-side, which is what that non-goal was actually protecting. Two new top-level folders sit outside `src/`: `worker/` (the Cloudflare Worker — `index.js` routes `/api/feedback` and hands everything else to `env.ASSETS.fetch`) and `shared/` (`feedbackLimits.js`, plain values). **New dependency rule, extending §3:** `shared/` holds environment-agnostic values only — no Workers globals, no DOM, no React — and `worker/` and `src/` may each import from it, never from each other. That's what lets the length limits be defined once and still leave the server authoritative (the client's `maxLength` is a UX hint; `worker/lib/validateFeedback.js` re-checks everything). **Abuse protection is two-layer:** Cloudflare Turnstile is the "is this a human" gate, and the native Rate Limiting binding (5/60s keyed on `CF-Connecting-IP`) only caps blast radius behind it — deliberately *not* a hand-rolled KV counter, whose get-then-put races exactly like the thing it would replace (true atomicity would need a Durable Object, disproportionate here). **Non-obvious pieces:** (1) this is the "Workers with static assets" deploy model, not Cloudflare Pages, so Pages' `functions/` auto-routing convention does not exist and routing is explicit in `worker/index.js` — the README's old Pages-dashboard flow *could not have served this route at all* and was replaced, not amended. (2) `src/lib/feedbackClient.js` returns a discriminated result instead of throwing, breaking the `ActivitySource` adapters' throw-on-failure convention on purpose: the UI has to render a 422's per-field map inline but a 429/502/network error as one banner, a distinction a single thrown `Error` carries badly. (3) The Turnstile widget is lazy-loaded via a module-level singleton promise and rendered *explicitly* (`turnstile.render(el, …)`), not via the implicit `data-sitekey` div — only the explicit API returns a widget id, which is what `remove()` (no leaked hidden iframes across repeated opens) and `reset()` (tokens are single-use, so every failed submit needs a fresh one) require. (4) `<dialog>`'s `close` listener is attached with `addEventListener`, not a JSX `onClose` prop, since React's synthetic handling of that native event is inconsistent — this also funnels the "×" button and a real Escape keypress through one path. (5) jsdom 30 still has no `showModal`/`close`, so `setupTests.js` gained a stub; it *does* apply the UA `dialog:not([open]){display:none}` rule and map `<dialog>` to role `"dialog"`, so that stub alone is enough for role-based queries. Escape-to-close itself is browser behaviour jsdom won't simulate — left to the manual walkthrough rather than chased with more stubs. (6) Watch out: "Feedback" contains "back", which silently broke the pre-existing `getByRole('button', {name: /back/i})` in `App.test.jsx`'s About test.
- [x] **2026-08-07: sample activity removed, file entrypoint promoted** — the loudest control on the page ("Load sample activity", the only filled `--metric-pace` button in the header) pointed at bundled demo data rather than at the thing the app is for, and the sticky-bar change above had left a first-time visitor with an otherwise *completely empty* page body: `AppShell` had no `status === 'idle'` branch at all, so the only entrypoint was a small dim dashed strip that reads as chrome. The whole sample path is deleted — button, `SAMPLE_REF`, the `{type:'id'}` dispatcher branch, `data/mock/MockActivitySource.js`, and the 38 KB `fixtures/sample-run.json` it served — rather than kept as scaffolding: once the button was its last caller, the mock adapter was dead weight, and the real-Garmin fixtures now cover everything it demonstrated. In its place, the load control **splits by status**: a hero drop target (`ui/EmptyState.jsx`, the filename `4be0ff4` deleted and §4 still listed) fills `<main>` while idle, and the compact header control appears once something is loading/ready/errored — so `4be0ff4`'s "swap activity without leaving the chart view" property is fully retained. `FileDropZone` grew a `variant` prop (`'compact' | 'hero'`) for this and switched its hardcoded `id="tcx-file-input"` to `useId()`. **The invariant to preserve: exactly one `FileDropZone` is mounted at any time** — `showEmptyState = status === 'idle' && !showAbout`, header control when that's false. It is load-bearing four times over: two CTAs on the idle page is the exact problem this change fixes; two instances would collide on one DOM id (hence `useId()`); three test files query the zone with `getByLabelText(/drop a tcx file|click to browse/i)`, which throws on two matches (hence both variants keeping the literal "click to browse" copy); and `AboutPage` replaces the whole of `<main>`, so without the `!showAbout` term a visitor who opened About on a fresh page would have *no* load control anywhere — that term is pinned by its own assertion in `App.test.jsx`. The dispatcher routes non-`file` refs to `TcxActivitySource` (which rejects them with a real error) instead of dropping the branch, or `isFitFile` would read `.name` off an undefined `ref.file`. `'mock'` stays in the `kind` union (§5) — nearly every UI test still drives `AppProviders` with an inline `{kind:'mock', load}` double.
- [x] **2026-08-07: GPX support, and with it a pipeline that no longer assumes ~1 Hz.** A commenter on the launch post asked for formats beyond TCX/FIT, naming a **SPOT X** satellite messenger and an **OM System Tough TG-7** camera — both export GPX. Before this, a dropped `.gpx` fell through `App.jsx`'s `.fit` check into `parseTcx`, parsed as XML, and died at the `<Activity>` lookup with a misleading *"is it a TCX export?"*. **The parser was the easy half.** These devices record position + elevation + time only, every 2.5–30 minutes, across days, with multi-hour satellite dropouts, and four places in the pipeline had "a continuous ~1 Hz recording of at most a few hours" baked in as a constant. A parser alone would have rendered *dishonestly* rather than errored, which is worse: `AVG 0:02 min/km` on a 100 km track, blank speed panels, a 6-hour dropout drawn as a straight diagonal, and axis ticks reading `259200`. Everything now hangs off one measured number, `Activity.samplingIntervalS` (new `domain/samplingInterval.js`: `medianIntervalOf` + `gapThresholdFor`, the latter exported because `detectPauses` and the UI's gap-break insertion must agree on where a gap is). **`gapThresholdFor(1) === 10` and the derived smoothing window at 1 Hz is still 9 samples — both asserted explicitly, and both `realGarminFixture` tests pass completely unchanged, which is the actual proof watch files are untouched.** The single root cause of the wrong numbers was `detectPauses`' fixed `GAP_THRESHOLD_S = 10` flagging *every* sample past the first as paused: fixing it also fixed `computeYDomain`'s collapse (one moving sample → `min === max` → `pad` falls back to `1` → `allowDataOverflow` clips the series away) and degenerate `median`/`extreme` stats, with no change to `stats/aggregate.js` at all. `deriveSpeed`'s smoothing window became 9 *seconds* converted at the recording's cadence, which at breadcrumb rates collapses to 1 sample, i.e. skip `smooth()` entirely — a delta measured over 10 minutes is already an average. New generic **`'track'` sport** for a GPS log with no sport of its own (a SPOT track is not a "Morning Run"); it is in every metric's `sports` except `pace`, since min/km is meaningless at breadcrumb sampling, so a track shows **Speed** instead. `deriveWorkoutName` now takes `totalTime` and drops the time-of-day bucket past 24 h ("3-day Track", not "Morning Track"). **Non-obvious pieces:** (1) **Recharts' `<Text>` splits a tick label on whitespace and stacks the words as separate `<tspan dy="1em">`s** — `"1d 0h"` renders on two lines with the second outside the axis band, so `units.js`'s new `makeElapsedTickFormatter`/`makeDistanceTickFormatter` emit `1d0h` and `450m`, and the "no tick label may contain a space" rule is pinned by its own test. Both are *factories* because Recharts hands `tickFormatter` only the value, never the span, and the right band depends entirely on the span. (2) Gap breaks are inserted into `MetricPanel`'s `data` memo (`domain/insertGapBreaks.js`), never into `activity.samples` — synthetic samples would corrupt `sampleDurations`, the distance axis and every stat; the inserted row carries **both** `t` and `d` because `xKey` flips with `xMode`, and a row missing the active key is dropped off the chart rather than breaking the line. Brush indices stay consistent because every panel builds `data` from the same samples with the same threshold. (3) `<time>` is **optional** in GPX, unlike TCX/FIT — a route or waypoint export is valid GPX with no timestamps at all, and gets its own user-facing error. (4) The GPX namespace is resolved from `documentElement.namespaceURI` (1.0 and 1.1 differ by one character) rather than hardcoded, and `<trk><type>` must be read as a *direct child* — `<link>` carries its own `<type>` (a MIME type) that a document-order search wins with. (5) **Real-data finding:** haversine over noisy 1 Hz fixes overestimates distance by **+0.92%** against Garmin's own figure for the same run (4755 m vs 4712 m, avg pace 6:19 vs 6:22/km) — the first real-data check of `buildDistanceAxis`'s haversine fallback and `deriveSpeed`'s derived path, both previously unit-tested only. Hence the 3% tolerance in `GpxActivitySource.realGarminFixture.test.js`, and its assertion that the drift is *positive*. (6) Noticed while building the sparse fixture, **fixed separately** in the entry below (pre-existing, affects TCX/FIT equally): `movingTimeOf` credits a gap's duration to the sample *before* it, which is still `moving`, so a pause's own duration lands in `totalMovingTime`.
- [x] **2026-08-07: load activities from intervals.icu — the phone route, and the first `{type:'id'}` ref the app has ever produced.** On a phone the app was close to unusable: the activity lives on a watch, syncs to Garmin Connect, and there is no practical way to get the file into a mobile browser. Garmin has no public consumer API (its developer program is a commercial agreement), but **intervals.icu already auto-syncs from Garmin Connect and retains the original uploaded `.fit`** — so it is used as a bridge: paste an API key once, browse the real activity history, tap a row, and the app downloads that activity's *original* file and runs it through the existing pipeline unchanged. **The finding that made it cheap: intervals.icu's `/api/v1/` sends CORS headers, reflects an arbitrary `Origin`, and lists `authorization` in `access-control-allow-headers` — so there is no proxy and no server-side code at all.** Contrast the feedback feature above, which needed a whole Worker route: this one adds nothing to `worker/`, and `npm run dev` alone is enough to develop it (`doc/FEEDBACK_SETUP.md` trains the opposite habit). Auth is HTTP Basic with the username **literally the string `API_KEY`** and the athlete's key as the password; `credentials: 'omit'` is mandatory since the API sends no `Access-Control-Allow-Credentials`, and no header outside `origin, authorization, accept, content-type, x-requested-with` may be sent or preflight starts failing. `0` is the "me" sentinel for any `{athleteId}` segment — there is no `/me`. **Storage decision: `localStorage`, with the trade stated rather than hidden.** The key is a *password*, not a session token — unscoped (the same Basic scheme authorises `PUT`/`DELETE` across the whole account), no expiry, revocable only by regenerating it — so in `localStorage` it is readable by any script on the origin, indefinitely, including on a device someone connected once and forgot. Accepted because re-pasting a key every visit defeats the phone use case, and mitigated three ways: the connect form says plainly what the key can do, Disconnect's copy says it removes the key *locally* without revoking it upstream, and `credentialStore.js` keeps the storage behind a factory argument so `sessionStorage` is a one-line change. **The seam became `data/intervals/`, not `data/http/` — and the stub is deleted.** §12 anticipated a *generic* HTTP source returning already-normalized samples; the real API hands back the original uploaded file, so the work is format detection plus reuse, not a new parser, and an `HttpActivitySource` would have misled the next reader. **Non-obvious pieces, every one of which cost or would have cost real time:** (1) **`newest` excludes its own day** — `newest=2026-05-30` means `…T00:00:00`, so sending `newest=<today>` silently drops everything recorded today. It is never sent; paging widens the window backwards and de-duplicates by `id`. (2) **`toApiDate` must be local-time.** `oldest`/`newest` are compared against `start_date_local`, so the obvious `new Date().toISOString().slice(0,10)` is UTC and shifts the window by a day for anyone not on UTC — dropping or duplicating a day's activities at the boundary. Built from `getFullYear`/`getMonth`/`getDate`, and unit-tested under two forced `TZ`s whose UTC day genuinely differs, with an assertion that the divergence is real so the test can't pass vacuously. (3) **Format is sniffed from the bytes, not from `file_type`** — no `Access-Control-Expose-Headers` is sent, so the browser **cannot read `Content-Disposition`** (no server-supplied filename) or `Retry-After`/`X-RateLimit-*` (a 429 gives a status and nothing more, which is why the rate-limit copy names no wait time). Sniffing also needs no extra call, survives a wrong `file_type`, and works for `ErrorState`'s "Try again", which replays a ref carrying no metadata. The `.FIT` magic is at **offset 8**, not 0. `file_type`/`source` survive only as a pre-flight guard that greys out unloadable rows. (4) **The download is gzipped, and inflating it must go through `Response`, never `Blob`** — under jsdom, `Blob` is jsdom's while `DecompressionStream` and `Response` are Node's (jsdom implements neither), and mixing them breaks. Gzip is detected by magic bytes rather than headers because it is unverified whether `/file` arrives as `Content-Encoding: gzip` (browser auto-inflates) or as opaque bytes; sniffing handles both. (5) **Strava-sourced activities come back as near-empty stub objects** where `id` may be the only property present, and have no downloadable file — every field read is null-guarded and those rows render `disabled` with the reason as *visible* text, never a `title` tooltip (invisible on touch). (6) **A CORS refusal and being offline are indistinguishable** — both surface as a bare `TypeError` from `fetch`, so both map to `network`. If this feature ever "goes offline" for everyone at once, that is the first thing to check. **Contract widening:** `IdActivityRef` gains an optional `name`, because intervals.icu *does* have a real title where FIT and TCX have none (§8) — tapping "Tempo 5×1k" and landing on a chart headed "Morning Run" reads as a bug. Purely additive; the adapter still works without it, pinned by a test. **`showAbout` became `view: 'activity'|'about'|'intervals'`** — one enum makes `about && intervals` unrepresentable, and the documented "exactly one `FileDropZone` mounted" invariant now reads `view === 'activity'` and is asserted across all three views. **Convention:** the two opposite ones in this codebase meet at the adapter. `intervalsApi.js` throws an `IntervalsApiError` carrying a stable `code` *and* a user-facing `message`: the adapter lets it propagate untouched (satisfying the port contract, where `ErrorState` renders `error.message` verbatim) while the picker — the only caller that can do anything smarter — catches and switches on `.code`, because "your key is no longer valid" (clear the store, drop to the connect form; one 401 is terminal, there is no retry loop) has to be told from "the network failed" (banner, stay connected). **The proof it was worth doing:** `IntervalsActivitySource.realGarminFixture.test.js` feeds the same Garmin activity the other three cross-checks use, **gzipped, through a stubbed `fetchImpl`**, and asserts the same distance, duration and avg pace to the second — *and* that `availableMetrics` includes `power`. One activity, four routes (file-TCX, file-FIT, file-GPX, network-FIT), identical numbers: Stryd developer-field power survives the network path, which it would not have through `/fit-file` (intervals.icu's *regenerated* file, deliberately not used). Note "original" still ≠ a byte-identical Garmin Connect export — Garmin filters some session-level summary fields (VO2max, recovery time) out of its own API — but per-record telemetry, which is everything this app charts, comes through intact, so the copy must not promise "identical to Garmin Connect".
- [x] **2026-08-07: pause and dropout duration no longer counted as moving time.** Carried over from the GPX entry's item (6) above. `movingTimeOf` attributed the interval `[t_i, t_i+1]` to sample `i`, but `detectPauses` flags the sample that **resumes** after a gap, never the one before it — so a gap's whole duration was always credited to a `moving: true` sample and landed in `totalMovingTime`. `stats/aggregate.js` held a verbatim copy of the same loop, carrying the identical defect into every time-weighted mean; **that duplication is why one defect lived in two files**, and both now call a single new `domain/sampleDurations.js`. On `fixtures/sparse-multiday.gpx` (45 breadcrumbs, 72 h elapsed, 3 nights in camp + one 6-hour dropout) `totalMovingTime` read **71.33 h of 72**, for an avg pace of **90:04 min/km**; it now reads **6.67 h** and **8:25 min/km**. **The rule:** an interval counts only when it is *real* — the device was still logging across it (`dt <= gapThresholdS`) — and, under `movingOnly`, only when it was *travelled*. **The literal "an interval is moving only when both ends are" rule that the old §12 seam note prescribed was considered and rejected**: because the flag lands on the resuming sample, a strict AND also discards the first real interval after every pause (6 s on a 1 Hz watch file, but 40 min / 11% on a 10-minute breadcrumb log), and it breaks the `movingOnly` cadence case outright — both moving samples get weight 0, `totalWeight` is 0, and avg cadence returns `null` instead of 170. One stopped end is a **boundary** (decelerating into a traffic light, or the first breadcrumb after a dropout) and stays counted; both stopped ends is a pause. Attribution is unchanged — still a left-end zero-order hold — only the *counting* moved. **Why it survived:** the Garmin cross-check fixture contains no pause anywhere (1 Lap / 1 Track / 1801 Trackpoints; FIT `sessionMesgs[0].totalTimerTime === totalElapsedTime === 1800.18`), *and* every assertion touching pauses was a weak inequality — `normalizeActivity.test.js` asserted `totalMovingTime < totalTime` on a case where the truth is 3 s and the code returned 32, and the sparse GPX suite asserted `> 0` against an answer that was 12x wrong. Those are now exact values, which is the durable half of the fix. **All four `realGarminFixture` suites (tcx/fit/gpx/intervals) pass with zero expectation changes** — no interval in that file exceeds the 10 s threshold and every sample is `moving`, so nothing there may move; that is the regression anchor. **Trap for anyone extending this:** `gapThresholdS` defaults to `Infinity`, *not* `gapThresholdFor(undefined)` — that returns **10**, which would read every interval of a sparse or hand-built activity as a gap and zero every weight, so `useMetricStats` guards on `samplingIntervalS != null`.
- [x] **2026-08-07: search the whole intervals.icu history, not just the loaded window.** The picker browses a rolling 90-day window widened backwards a page at a time, so finding a workout from last spring meant pressing "Load earlier activities" until it appeared. `GET /athlete/0/activities/search-full?q=` is a **second read path** alongside `/activities`: it takes no `oldest`/`newest` and covers the entire history, which is the whole point. **The endpoint choice is the decision worth recording.** The obvious pick, `/activities/search`, returns an `ActivitySearchResult` — `id, name, start_date_local, type, race, distance, moving_time, tags, description` — which is *missing exactly the three fields the picker depends on*: `source` and `file_type` for `unsupportedReason`'s pre-flight guard (without `source`, every Strava row looks pickable and fails only after a download), and `source`/`device_name` for the Garmin attribution API Terms §1.1 requires. It also names distance `distance` where every row renderer here reads `icu_distance`. So `/search-full` was chosen knowing it returns full ~183-property rows and that **neither search endpoint accepts a `fields` projection** (unlike `/activities`, hence `ACTIVITY_LIST_FIELDS` deliberately not applying) — the payoff is that hits render through `IntervalsActivityList` with **no row-rendering change at all**. **The invariant that constrains any future work here: search hits must never be merged into `activities`.** `mergeById` and `nextWindowStart` both assume that list is a contiguous newest-first window anchored on real dates; folding in arbitrary matches from years back would send the "Load earlier" anchor somewhere it can never recover from. Results live in their own state, one list is rendered at a time, and "Load earlier" is *absent* (not disabled) while searching, because there is no window under the hits to widen. Clearing the box therefore costs nothing: the browse effect keys on `windowStart` and never re-fired, so the window is simply still there. **Free behaviour:** a `q` starting with `#` is an exact tag search server-side, so `#threshold` works through the same input with no tag UI, no `/activity-tags` call and no `#` handling in the client. **Debounced 300 ms, minimum 2 characters** — and the debounce delays *starting* a search only: emptying the box returns to browsing on the keystroke rather than leaving stale hits up for another 300 ms. Stale responses are handled by this file's pre-existing `let cancelled = false` cleanup, which debounced typing is exactly the case for. **Test trap that would have made every search test pass for the wrong reason:** `stubApi()` in `IntervalsPage.test.jsx` routes on `url.includes('/activities')`, which also matches `/activities/search-full` — the `/search-full` branch has to come first, or the search tests are quietly served the browse fixture. **Second trap:** RTL's `waitFor` cannot drive Vitest's fake clock here — `jestFakeTimersAreEnabled()` checks for a `jest` global that `globals: false` never provides — so `vi.useFakeTimers()` in a page test hangs `waitFor` instead of speeding it up. The page tests use real timers and wait the debounce out (`userEvent.setup({ delay: null })` keeps a typed burst from straddling the window); the timing itself is proven at unit level in `useDebouncedValue.test.js`.
- [ ] `domain/downsample.js` (LTTB) — deferred until a long activity is actually sluggish

---

## 1. Purpose

A web UI in the spirit of Intervals.ICU / Garmin Connect: load a single running activity and inspect several metrics as **vertically stacked, time-synced line charts** sharing one x-axis (elapsed time or distance). The user toggles which metrics are shown, and toggles **max / min / avg / median** horizontal reference lines per metric.

**Explicit non-goals for v1:** swimming, imperial units, multi-activity comparison, persistence, auth, tests, server-side anything.

*(Three of those have since gained a narrow, deliberate exception — see §0. **Server-side anything:** the feedback form needed a Worker. **Persistence and auth:** the intervals.icu connection stores one third-party API key in `localStorage`. Both are strictly opt-in and both are off for a visitor who only ever drops files, who still issues zero network requests — asserted, not assumed. Worth noting that the intervals.icu feature needed **no** server-side code at all: the browser talks to intervals.icu directly.)*

---

## 2. Constraints that shape the design

| Constraint | Consequence |
| --- | --- |
| API will replace TCX later | All input goes through an `ActivitySource` port; adapters are injected via React context. No component ever imports the TCX parser. |
| Swimming may come later | Metrics are declared in a **registry**, not hardcoded into components. `Activity.sport` exists from day one — cycling already uses this (§6). |
| Metric only | SI units are stored internally; conversion happens **only** in display formatters. Nothing else changes if imperial is ever added. |
| Recharts | `syncId` gives synced tooltip/crosshair for free, but **not** synced zoom — zoom must be a controlled `XAxis domain` fed identically to every panel. |
| ≥4 simultaneous charts | Rendering cost matters. Downsample for display, memoize aggressively, never recompute stats on hover. |
| A third-party credential is held in the browser | The intervals.icu API key goes **only** to intervals.icu, never to this app's own Worker — no proxy, `credentials: 'omit'`, and the key never appears in a URL, a log, an error message, or the feedback form. It is a password, not a session token (§0), so the UI says what it can do and Disconnect says what it does *not* do. |

---

## 3. Layer diagram

```mermaid
flowchart TB
  subgraph UI["4 · UI Layer (React + Recharts)"]
    App[App]
    Ctl[ControlPanel<br/>x-axis mode · metric toggles · max-min-avg-median checkboxes]
    Stack[ChartStack<br/>shared syncId + shared x-domain]
    Panel["MetricPanel xN<br/>LineChart + ReferenceLine per active stat"]
    Brush[BrushControl<br/>bottom panel only · writes zoom domain]
    App --> Ctl
    App --> Stack
    Stack --> Panel
    Stack --> Brush
  end

  subgraph STATE["3 · State & Derivation"]
    AC[ActivityContext<br/>activity · status · error]
    VC[ChartViewContext<br/>xMode · zoomDomain · enabledMetrics · enabledStats]
    REG[metricRegistry<br/>id · label · unit · color · accessor · format · invert · aggStrategy]
    STATS[useMetricStats<br/>memoized max-min-avg-median]
  end

  subgraph DOMAIN["2 · Domain Pipeline (pure, framework-free)"]
    NORM[normalizeActivity]
    DERIVE[buildDistanceAxis · deriveSpeed · detectPauses · smooth]
    MODEL[(Activity<br/>samples: t s · d m · speed m/s · hr bpm · cadence spm · power W · altitude m)]
    NORM --> DERIVE --> MODEL
  end

  subgraph DATA["1 · Ports & Adapters (DI boundary)"]
    PORT{{"ActivitySource port<br/>load ref → Promise Activity"}}
    TCX[TcxActivitySource · FitActivitySource · GpxActivitySource]
    API[IntervalsActivitySource<br/>downloads the ORIGINAL file, sniffs its<br/>format, reuses parseFit/parseTcx/parseGpx]
    TCX -.implements.-> PORT
    API -.implements.-> PORT
  end

  FILE[/TCX · FIT · GPX file upload/] --> TCX
  ICU[/intervals.icu API<br/>browser → intervals.icu direct, no proxy/] --> API
  TCX --> NORM
  API --> NORM
  MODEL --> AC
  AC --> STATS
  REG --> STATS
  REG --> Panel
  STATS --> Panel
  VC --> Panel
  VC --> Stack
  Ctl --> VC
  Brush --> VC
  PORT -.injected via ActivitySourceProvider.-> AC
```

**Dependency rule:** arrows point inward-to-outward only. `domain/` imports nothing from `ui/`, `data/`, or React. `data/` imports `domain/` types only. Violating this breaks the future API swap.

---

## 4. Folder scaffold

```
src/
  main.jsx
  App.jsx
  app/
    providers.jsx            # composes ActivitySourceProvider + ActivityProvider + ChartViewProvider
  data/
    ActivitySource.js        # port: JSDoc typedef + createActivitySource contract
    tcx/
      TcxActivitySource.js   # implements port; DOMParser based
      parseTcx.js            # XML -> RawTrackpoint[]; pure, no domain logic
    fit/
      FitActivitySource.js   # implements port; @garmin/fitsdk based
      parseFit.js            # FIT binary -> RawTrackpoint[]; pure, no domain logic. async — dynamic-imports @garmin/fitsdk
    gpx/
      GpxActivitySource.js   # implements port; DOMParser based
      parseGpx.js            # XML -> RawTrackpoint[]; pure, no domain logic
    intervals/               # intervals.icu bridge — the ONLY networked data path
      IntervalsActivitySource.js  # implements port for {type:'id'}; adds NO parsing of its own
      intervalsApi.js        # low-level client; injectable fetchImpl; throws coded IntervalsApiError
                             #   two read paths: listActivities (window) + searchActivities (history)
      credentialStore.js     # the API key in localStorage, behind an injectable storage
      detectActivityFormat.js # pure: gunzip + bytes -> 'fit'|'tcx'|'gpx'|null
  domain/
    types.js                 # Activity, Sample, RawTrackpoint typedefs
    normalizeActivity.js     # RawTrackpoint[] -> Activity  (the pipeline entry point)
    deriveSpeed.js
    buildDistanceAxis.js
    detectPauses.js
    samplingInterval.js      # medianIntervalOf + gapThresholdFor — every rate-adaptive threshold reads these
    insertGapBreaks.js       # display-only: nulls inside a dropout so the line breaks. NOT a Sample field
    smooth.js                # centred rolling mean, window in samples
    downsample.js            # LTTB for display; domain stays full-resolution
    units.js                 # SI conversions + formatters (mm:ss, km, bpm...) + axis tick formatter factories
  stats/
    aggregate.js             # max / min / avg / median, strategy-aware
    useMetricStats.js        # memoized hook over activity + registry
  metrics/
    metricRegistry.js        # THE extension point — see §6
  state/
    ActivityContext.jsx
    ChartViewContext.jsx
  lib/
    feedbackClient.js        # POST /api/feedback; returns a discriminated result, never throws
  ui/
    ChartStack.jsx
    MetricPanel.jsx
    ControlPanel.jsx
    MetricToggle.jsx
    StatCheckboxes.jsx
    XAxisModeSwitch.jsx
    FileDropZone.jsx
    SyncedTooltip.jsx
    EmptyState.jsx
    ErrorState.jsx
    AboutPage.jsx
    IntervalsPage.jsx        # the full view; owns the connected/disconnected state machine
    IntervalsConnectForm.jsx # validates the key before it is ever stored
    IntervalsActivityList.jsx # rows as real <button>s + "Load earlier activities"
    FeedbackWidget.jsx       # footer trigger; owns isOpen
    FeedbackDialog.jsx       # <dialog> shell; form mounted only while open
    FeedbackForm.jsx         # fields + Turnstile mount point + result states
    useTurnstile.js          # lazy script load, explicit render/remove/reset
  styles/
    tokens.css
    global.css
shared/
  feedbackLimits.js          # plain values, imported by BOTH worker/ and src/
worker/                      # Cloudflare Worker (wrangler.jsonc `main`)
  index.js                   # /api/feedback -> route; everything else -> env.ASSETS.fetch
  routes/
    feedback.js              # method -> size -> parse -> validate -> rate limit -> Turnstile -> GitHub
  lib/
    validateFeedback.js      # server-authoritative; the client's maxLength is only a hint
    buildIssuePayload.js     # pure: submission + metadata -> {title, body, labels}
    verifyTurnstile.js       # injectable fetchImpl; fails closed
    githubClient.js          # injectable fetchImpl; never returns GitHub's body or the token
    rateLimit.js             # wrapper over env.FEEDBACK_RATE_LIMITER.limit()
    httpResponses.js
fixtures/
  activity_23870166877.tcx        # real Garmin export, cross-checked against
  activity_23870166877-meta.json  # ...Garmin's own reported stats
  23870166877_ACTIVITY.fit        # same activity as FIT, carries Stryd power
  activity_23870166877.gpx        # ...and as GPX: same run reduced to lat/lon/ele/time
  sparse-multiday.gpx             # hand-built SPOT X / TG-7 shape: 10-min breadcrumbs over 3 days
```

**Dependency rule for the two new top-level folders:** `shared/` holds
environment-agnostic *values* only — no Workers globals (`Response`, `env`), no
DOM, no React. `worker/` and `src/` may each import from `shared/`; neither may
import from the other.

---

## 5. Core contracts

Types are given as TypeScript for precision. If the project stays JavaScript, express these as JSDoc `@typedef` in `domain/types.js` — the shapes are binding either way.

```ts
type Sport = 'running' | 'cycling' | 'track';  // 'track' = a GPS log with no sport of its own (GPX). Union grows later (swimming, ...)
type MetricId = 'pace' | 'speed' | 'heartRate' | 'cadence' | 'power' | 'altitude';
type StatKind = 'max' | 'min' | 'avg' | 'median';
type XAxisMode = 'time' | 'distance';

/** One normalized sample. SI units, always. */
interface Sample {
  t: number;            // seconds since activity start (monotonic, gap-aware)
  d: number;            // cumulative metres (monotonic, non-decreasing)
  speed?: number;       // m/s   — pace/speed are derived at display time
  heartRate?: number;   // bpm
  cadence?: number;     // steps/min for running (NOT strides), pedal rpm for cycling — see §8
  power?: number;       // watts
  altitude?: number;    // metres
  moving: boolean;      // false inside a detected pause
}

interface Activity {
  id: string;
  sport: Sport;
  name: string;                 // inferred (not read verbatim — neither FIT nor TCX has a title field)
  startTime: Date;
  totalTime: number;            // s, elapsed
  totalMovingTime: number;      // s
  totalDistance: number;        // m
  samples: Sample[];            // full resolution
  samplingIntervalS: number;    // median gap between samples; THE input to every rate-adaptive threshold (§8)
  availableMetrics: MetricId[]; // drives which panels can render
}

/** Untouched adapter output. Adapters do no interpretation beyond field mapping. */
interface RawTrackpoint {
  time: Date;
  distanceMeters?: number;
  altitudeMeters?: number;
  heartRateBpm?: number;
  cadenceSpm?: number;          // running: already doubled if source was strides. cycling: pedal rpm, undoubled
  watts?: number;
  speedMps?: number;
  lat?: number;
  lon?: number;
}

/** THE dependency-injection boundary. */
interface ActivitySource {
  readonly kind: 'tcx' | 'fit' | 'gpx' | 'intervals' | 'mock';
  load(ref: ActivityRef): Promise<Activity>;
}

type ActivityRef =
  | { type: 'file'; file: File }
  // `name` is optional and purely additive: only the intervals.icu picker can
  // fill it in, because neither FIT nor TCX carries a title (§8). Every
  // consumer must still work without it.
  | { type: 'id'; id: string; name?: string };
```

`ActivitySourceProvider` takes a source instance as a prop and publishes it on context. Swapping the source is exactly:

```jsx
<ActivitySourceProvider source={new IntervalsActivitySource({ getApiKey })}>
```

No other file changes. In practice `App.jsx` publishes one dispatcher object that picks the concrete adapter per ref — by extension for `{type:'file'}`, and `IntervalsActivitySource` for `{type:'id'}` — but that dispatcher is still the *only* place a concrete adapter is constructed.

---

## 6. Metric registry — the extension point

Adding elevation, or later swimming's stroke rate, must mean **adding one object here** and nothing else. `unit` may be a plain string or a `(sport) => string` function when it varies by sport (cadence: spm vs rpm) — resolve it via `metricUnit(metric, sport)`, never `metric.unit` directly. Per-metric `sports: [...]` gates which activities offer that metric at all — filtered in via `isMetricForSport()` at both `ControlPanel` and `ChartStack`.

```js
// metrics/metricRegistry.js
export const metricRegistry = {
  pace: {
    id: 'pace',
    label: 'Pace',
    unit: 'min/km',
    color: 'var(--metric-pace)',
    accessor: (s) => (s.speed && s.speed > 0.3 ? 1000 / s.speed : null), // s per km
    format: formatPace,          // 287 -> '4:47'
    invertAxis: true,            // faster reads higher
    aggStrategy: 'weightedPace', // see below
    domainPadding: 0.08,
    sports: ['running'],         // NOT 'track': min/km is meaningless at breadcrumb sampling
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    unit: 'km/h',
    color: 'var(--metric-pace)', // shares pace's hue — the two never render together
    accessor: (s) => (s.speed != null ? mpsToKmh(s.speed) : null),
    format: formatSpeedKmh,      // 28.42 -> '28.4'
    invertAxis: false,
    aggStrategy: 'movingOnly',   // avg speed IS the time-weighted mean by definition; movingOnly just excludes pauses
    domainPadding: 0.08,
    sports: ['cycling', 'track'], // the "how fast" panel for everything except running
  },
  heartRate: { id:'heartRate', label:'Heart rate', unit:'bpm', accessor:(s)=>s.heartRate ?? null,
               format:(v)=>Math.round(v), invertAxis:false, aggStrategy:'timeWeighted', sports:['running','cycling','track'] },
  cadence:   { id:'cadence',   label:'Cadence',   unit:(sport)=>(sport==='cycling'?'rpm':'spm'), accessor:(s)=>s.cadence ?? null,
               format:(v)=>Math.round(v), aggStrategy:'movingOnly', domainPadding: 0.08, sports:['running','cycling','track'] },
  power:     { id:'power',     label:'Power',     unit:'W',   accessor:(s)=>s.power ?? null,
               format:(v)=>Math.round(v), aggStrategy:'timeWeighted', sports:['running','cycling','track'] },
  altitude:  { id:'altitude',  label:'Elevation', unit:'m',   accessor:(s)=>s.altitude ?? null,
               format:(v)=>Math.round(v), aggStrategy:'timeWeighted', sports:['running','cycling','track'] },
};

export const metricOrder = ['pace', 'speed', 'heartRate', 'power', 'cadence', 'altitude'];
```

**Aggregation strategies** (`stats/aggregate.js`):

- `timeWeighted` — mean weighted by the duration each sample represents. Sampling is often irregular; a naive array mean silently over-weights dense sections.
- `movingOnly` — same, but excludes `moving === false` samples. Correct for cadence: standing still is not 0 spm, it's *no data*.
- `weightedPace` — **average pace = totalMovingTime ÷ totalDistance.** Never the mean of instantaneous paces; that is mathematically wrong and will visibly disagree with every other app the user owns.
- Median for all strategies: computed over moving samples only, un-weighted, on the raw (unsmoothed) series.

**Which intervals carry weight** (`domain/sampleDurations.js`, shared with `normalizeActivity`): a sample's weight is the interval *forward* to the next sample (left-end zero-order hold), and it counts only when the interval is **real** — `dt <= gapThresholdS`, i.e. the device was still logging across it. Under `movingOnly` it must also have been **travelled**, which requires *both* ends stopped before it is dropped. So `movingOnly` differs from `timeWeighted` in sample *membership* (the `moving === false` filter, since a stopped sample's cadence is not data) **and** in interval *weight* — two separate mechanisms that are easy to conflate. Time inside a recording gap is weightless under both: holding the last reading across a six-hour dropout lets one campsite altitude sample outweigh a day of walking.

Stats are computed over the **whole activity**, not the zoom window. Keep this fixed; reference lines that drift as the user brushes are disorienting. If a "stats follow zoom" toggle is wanted later, add it explicitly in `ChartViewContext`.

---

## 7. Rendering rules

**ChartStack**
- One `MetricPanel` per id in `metricOrder` that is both in `activity.availableMetrics` and in `viewState.enabledMetrics`.
- Every panel gets the identical `syncId="activity"`, the same `XAxis dataKey`, and the same controlled `domain={zoomDomain}`.
- `XAxis` is `type="number"` with `dataKey` = `t` or `d` depending on `xMode`. **Never use category axis** — sampling is irregular and category spacing would lie about time.
- Only the bottom panel renders `XAxis` ticks and the `Brush`; upper panels set `hide` on their axis but keep identical `domain` and left `YAxis` width so the plot areas align pixel-for-pixel. Fixed `yAxisWidth` token, not `auto`.
- Panel heights: first panel ~200px, subsequent ~140px. Whole stack scrolls with the page; do not nest scroll areas.

**MetricPanel**
- `<LineChart>` with `dot={false}`, `isAnimationActive={false}` (animation on 10k points is a jank generator), `connectNulls={false}` so sensor dropouts render as gaps rather than invented straight lines. Sparse recordings carry no nulls of their own, so `domain/insertGapBreaks.js` puts one *in the chart rows only* (never in `activity.samples`) wherever the elapsed gap exceeds `gapThresholdFor(activity.samplingIntervalS)` — the same threshold `detectPauses` uses, so the visual break and the paused-sample flag always agree.
- `XAxis` gets a `tickFormatter` built by span (`units.js`, §8) — raw elapsed seconds are unreadable past an hour and absurd past a day. **No tick label may contain a space:** Recharts stacks whitespace-separated words as separate `<tspan dy="1em">`s, pushing the second line out of the axis band.
- For each enabled `StatKind`, render a `<ReferenceLine y={value}>` (no inline label) so the horizontal indicator still shows where the stat sits relative to the line; dash patterns distinguish kinds: max `4 4`, min `1 2`, avg solid-thin, median `2 3`. The stat's text (`` `${label} ${format(value)} ${unit}` ``) renders as a "chip" in a plain-HTML row below the chart (`StatSummary`, outside the SVG) rather than as a positioned label — always shown for every enabled stat, no show/hide toggle.
- `invertAxis: true` → `<YAxis reversed />` plus reversed domain calculation.

**Tooltip**
- One shared `SyncedTooltip` component used by all panels so the hovered sample reads identically everywhere. Header shows both elapsed time *and* distance regardless of `xMode` — users think in both.

**Downsampling**
- Below ~2,000 samples, render raw. Above, run LTTB (largest-triangle-three-buckets) to ~1,500 points **for display only**, keyed on the current zoom domain so zooming reveals real detail. Stats always use the full-resolution series.

---

## 8. TCX, FIT & GPX parsing notes (these cost real debugging time)

### TCX

- Namespace: `http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2`. Use `getElementsByTagNameNS` or strip namespaces — plain `getElementsByTagName` fails inconsistently across browsers on namespaced docs.
- Structure: `TrainingCenterDatabase > Activities > Activity > Lap+ > Track+ > Trackpoint+`. Flatten all laps into one sample array; keep lap boundary times aside for a possible future lap overlay.
- **Running cadence lives in `Extensions > TPX > RunCadence` and is in strides per minute — multiply by 2 to get steps per minute.** The plain top-level `<Cadence>` element is the *cycling* field instead — already pedal rpm, no doubling. `parseTcx` branches on the resolved `sport` (`Activity Sport="Running"` → `RunCadence`×2, `Sport="Biking"` → plain `<Cadence>`) rather than reading both.
- `Activity Sport` maps `"Running"` → `'running'`, `"Biking"` → `'cycling'`; anything else (e.g. `"Other"`) is rejected with a user-facing error, same as an unparseable file.
- Power: `Extensions > TPX > Watts`. Often absent — that is normal, not an error. (Garmin Connect's FIT→TCX export drops power even when the original FIT file has it via a developer field — see FIT notes below.)
- Speed: `Extensions > TPX > Speed` in m/s when present. When absent, derive from distance/time deltas, then smooth (5–15 s window) or the pace chart will be unreadable noise.
- `<DistanceMeters>` can be missing, non-monotonic, or reset. `buildDistanceAxis` must enforce monotonicity: clamp any decrease to the previous value, and fall back to haversine over lat/lon if distance is absent entirely.
- Trackpoints with only a `<Time>` and nothing else are common. Drop them before normalization.
- Pause detection: gap between consecutive timestamps > 10 s, or speed < 0.3 m/s sustained over > 10 s → mark `moving: false`. Keep the samples; do not delete them, or elapsed-time x-axis breaks.
- Those flags are a *point* property; durations are an *interval* property, and `domain/sampleDurations.js` is the only place that converts one into the other. Note that the gap trigger flags the sample that **resumes** after a gap, never the one before it — which is why an interval needs *both* ends stopped before it counts as a pause rather than as a boundary.

Parsing is synchronous for now. If files exceed ~20k trackpoints, move `TcxActivitySource` into a Web Worker — the port boundary makes that change invisible to everything above it.

### FIT

Decoded with `@garmin/fitsdk` (official Garmin package, zero runtime deps, pure ESM — `Stream.fromArrayBuffer(buffer)` + `new Decoder(stream).read()`, no options object needed since the useful defaults — `applyScaleAndOffset`, `convertTypesToStrings`, `convertDateTimesToDates`, etc. — are already `true`).

- **Power is frequently only a *developer field*, not the standard `record` field.** A Stryd pod's FIT export declares power via a `field_description` message (`native_mesg_num: 20` i.e. `record`, `native_field_num: 7`, the standard power field it mirrors), tied to a `developer_data_id` message whose `application_id` is Stryd's registered FIT app id (`18fb2cf0-1a4b-430d-ad66-988c847421f4`). The decoder does **not** merge developer field values into the record object by name — each decoded `record` message's `developerFields` object is keyed by a sequential `key` assigned during decode (visible on `fieldDescriptionMesgs[].key`), not by `fieldDefinitionNumber`. Resolve the key once per file by matching `fieldDescriptionMesgs` on `nativeMesgNum === 20 && nativeFieldNum === 7`, then read `record.developerFields[thatKey]`. Check the standard `record.power` field first regardless, so a power meter that populates field 7 natively still works without going through developer-field resolution.
- **Running cadence is per-leg, exactly like TCX's `RunCadence` — multiply `record.cadence` by 2 to get steps per minute.** Verified against a real export: `sessionMesgs[0].avgCadence`/`avgRunningCadence` matched the raw per-record `cadence` mean before doubling. Cycling cadence (`sessionMesgs[0].sport === 'cycling'`) is already pedal rpm — `record.cadence` passes through undoubled. Sport comes from `sessionMesgs[0].sport`, already resolved to a string (`'running'`/`'cycling'`) by the SDK; missing session data defaults to `'running'` rather than blocking.
- `positionLat`/`positionLong` are raw semicircle integers — the SDK does not auto-convert these despite converting everything else. Multiply by `180 / 2**31` to get degrees.
- `record.enhancedAltitude`/`enhancedSpeed` are already scaled by the decoder; prefer them over the plain `altitude`/`speed` fields (only present on older/lower-resolution devices).
- A non-FIT/garbage buffer does not throw synchronously — `decoder.read()` returns `{ messages: {}, errors: [Error(...)] }`. `parseFit` checks `errors.length` itself, mirroring how `parseTcx` throws a friendly message on invalid XML.
- **Neither FIT nor TCX carries a genuine free-text activity title** — that's a Garmin Connect database concept, not part of either file export (confirmed by decoding the real fixtures). FIT does carry the watch's sport-profile label though: `sessionMesgs[0].sportProfileName` (e.g. `"Trail Run"` for a custom profile, `"Run"` for the default one) and `sportMesgs[0].name`, which are typically duplicates of each other — `parseFit` checks both (`sportProfileName` first) since either can be absent, and exposes the result as `sportLabel`. TCX has no equivalent field anywhere in the schema — its only `<Name>` elements are `<Creator><Name>` (device model) and `<Author><Name>` (exporting app), neither usable as a title. `domain/deriveWorkoutName.js` uses `sportLabel` when present, falling back to a generic sport-based label (`"Run"`/`"Ride"`) otherwise — see its own header comment for the time-of-day bucketing rules.
- The package is ~1.3 MB unpacked, almost all of it `src/profile.js` (the full FIT field/message profile table). `parseFit.js` dynamically `import()`s it internally so TCX-only users don't pay for it — this is also why `parseFit`, unlike sync `parseTcx`, returns a `Promise`.

### GPX

Parsed with `DOMParser` + `getElementsByTagNameNS`, same as TCX and with no new dependency. The format itself is the *simplest* of the three; what it costs is downstream, because the devices that emit it record nothing like a watch does.

- **Resolve the namespace from the document, never hardcode it.** GPX 1.1 is `http://www.topografix.com/GPX/1/1`, but 1.0 files (`.../GPX/1/0`) are still common from older loggers, and the two differ by one character. `parseGpx` reads `documentElement.namespaceURI`, checks `localName === 'gpx'`, and rejects any other namespace rather than guessing.
- **`lat`/`lon` are attributes on `<trkpt>`**, not child elements as in TCX. Elevation is `<ele>`, in metres.
- **`<time>` is optional in GPX**, unlike TCX and FIT. A route or waypoint export is a perfectly valid GPX file with no timestamps anywhere, and nothing in a timeseries view can be placed on an axis without one — it gets its own user-facing error ("looks like a route or waypoint list, not a recorded track"), since reporting it as an empty file would send the user looking for the wrong problem.
- Structure: `gpx > trk+ > trkseg+ > trkpt+`, flattened into one array the way `parseTcx` flattens laps. Segment boundaries are the recorder's own idea of a dropout; `detectPauses` re-derives them from the timestamps anyway.
- **Sport comes from `<trk><type>`, read as a *direct child*.** `<trk>` may also contain a `<link>`, which has its own `<type>` holding a MIME type — a document-order descendant search picks that up instead. The value is free text (`run|running|jogging` → `running`, `bike|biking|cycling|cycle|ride` → `cycling`); anything else, including the bare numeric code Strava writes, and the common case of no `<type>` at all, resolves to the generic `'track'` sport.
- **No distance and no speed element exists in GPX.** `buildDistanceAxis` takes its haversine-over-lat/lon path and `deriveSpeed` its derived path — both pre-existing, both previously unit-tested only. Measured against Garmin's own figures for the same run: haversine over noisy 1 Hz fixes **overestimates by ~0.9%** (4755 m vs 4712 m), because per-second GPS noise accumulates as extra distance. Pace inherits exactly that drift and nothing more (6:19 vs 6:22/km).

### intervals.icu original files

`GET /api/v1/activity/{id}/file` returns the **original uploaded file**, not a re-export — so **every note above applies to this path unchanged**, Stryd developer-field power especially. That is the whole reason `/fit-file` (intervals.icu's *regenerated* file, whose laps come from ICU intervals and which loses anything that didn't survive import) is deliberately not used. Where it differs is getting from a `Response` to a buffer a parser will accept:

- **The format is decided by the bytes, never by `file_type`.** No `Access-Control-Expose-Headers` is sent, so the browser cannot read `Content-Disposition` — there is no filename and therefore no extension to switch on. `file_type` is also only whatever the syncing service claimed, and `{type:'id'}` refs deliberately carry no metadata so `ErrorState`'s "Try again" can replay one. `file_type`/`source` survive as a **pre-flight guard in the picker** that greys out rows that can't work; they are not the authority.
- **The `.FIT` magic is at offset 8, not 0.** The FIT header is 14 bytes with ASCII `.FIT` at bytes 8–11 — a sniff that looks at the start of the buffer finds nothing.
- **TCX and GPX are identified by root element**, after stripping a BOM, an XML prolog, a DOCTYPE and any number of comments (exporters emit all four), and after dropping a namespace prefix — `<ns0:gpx>` and `<gpx>` are the same element.
- **The download is gzipped, and inflating it must go through `Response`, never `Blob`.** Under this project's jsdom environment `Blob` is jsdom's, while `DecompressionStream` and `Response` are Node's (jsdom implements neither), so mixing them breaks. This exact pattern round-trips: `await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()`.
- **Gzip is detected by magic bytes (`0x1f 0x8b`), not by a header.** It is unverified whether `/file` arrives as `Content-Encoding: gzip` (the browser auto-inflates and we get plain bytes) or as an opaque gzip payload; sniffing handles both without caring which. This is *why* it's designed that way rather than trusting `Content-Encoding`.
- **`newest` excludes its own day** — `newest=2026-05-30` means `…T00:00:00`, so `newest=<today>` drops everything recorded today. It is never sent; `oldest` is required and always is.
- **The unreadable-headers consequence, again:** `Retry-After` and `X-RateLimit-*` are invisible too, so a 429 gives a status and nothing more. Don't write code that reads them, and don't write copy that promises a wait time.
- **No `setupTests.js` additions were needed for any of this.** jsdom 30 supplies `localStorage`, `btoa` and `File`; Node 24 supplies `Response`, `DecompressionStream`, `CompressionStream`, `TextDecoder` and `fetch`. Recorded because "does this need a new stub" has cost this repo real time before — see §0's `ResizeObserver`, `getBoundingClientRect` and `showModal` entries.

**Two read paths reach the picker, and they are not interchangeable** (§0):

| | `GET /athlete/0/activities` | `GET /athlete/0/activities/search-full` |
| --- | --- | --- |
| Covers | a rolling window (`oldest`, widened backwards) | the **whole history**; takes no `oldest`/`newest` |
| Row shape | projected via `fields=ACTIVITY_LIST_FIELDS` | full ~183-property `Activity` — **no `fields` param exists here** |
| Feeds | `activities`, merged by `mergeById` | `results`, its own state, **never merged** |

Use `/search-full` rather than the lighter `/search`: `ActivitySearchResult` omits `source`, `file_type` and `device_name` — the pre-flight guard and the Garmin attribution both need them — and names distance `distance` instead of `icu_distance`. Paying for full rows is what makes a hit render through the same row code as a browsed activity. `q` beginning with `#` is an exact **tag** search server-side, which is why there is no tag UI. Neither path is cached (§12).

### Sampling-rate adaptivity (why GPX needed more than a parser)

A SPOT X or a TG-7 logs a position every 2.5–30 minutes, for days, with multi-hour dropouts. Four constants assumed ~1 Hz; all four now scale off `Activity.samplingIntervalS` (`medianIntervalOf` — a median so one long outage can't drag the "typical" interval up):

| What | Was | Now |
| --- | --- | --- |
| `detectPauses` gap trigger | `> 10 s` | `> gapThresholdFor(intervalS)` = `max(10, 4 × intervalS)` |
| `detectPauses` sustained-slow window | `> 10 s` | same scaling (`SLOW_SPEED_MPS = 0.3` stays fixed — it's a physical threshold, not a sampling one) |
| `deriveSpeed` smoothing | 9 **samples** | 9 **seconds**, converted at `intervalS`; collapses to 1 sample (skip `smooth()`) at breadcrumb rates |
| x-axis ticks | raw seconds | `makeElapsedTickFormatter(span)` (§7) |

At 1 Hz every one of these resolves to its original value — that is what makes the change a no-op for watch files, and both `realGarminFixture` tests are the standing proof.

---

## 9. Visual tokens

The chart *is* the interface, so the chrome stays quiet and the ink stays loud. Dark neutral ground, one hue per metric, everything else greyscale.

```css
/* styles/tokens.css */
:root {
  --bg:            #12151a;
  --panel:         #171b22;
  --grid:          #232935;
  --text:          #e6e9ef;
  --text-dim:      #8b93a3;
  --stat-line:     #6f7889;

  --metric-pace:      #4cc9f0;
  --metric-heartrate: #ef476f;
  --metric-power:     #ffd166;
  --metric-cadence:   #06d6a0;
  --metric-altitude:  #9b8cff;

  --panel-gap: 4px;      /* tight — panels must read as one instrument */
  --y-axis-width: 56px;  /* FIXED, shared by all panels for alignment */
  --radius: 6px;
  --font-ui:   system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-data: 'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
}
```

Numerals — axis ticks, tooltip values, reference-line labels, stat readouts — all use `--font-data` with tabular figures so digits don't jitter as values change under the cursor. Labels and controls use `--font-ui`. Metric hue is used consistently for that metric's line, its panel title, and its toggle chip; reference lines stay neutral grey so they never compete with the data.

Quality floor: visible keyboard focus rings, all toggles reachable by keyboard, `prefers-reduced-motion` respected (there is almost no motion to begin with), layout collapses to a single column below 720px with panel heights reduced ~25%.

---

## 10. State shape

```js
// ChartViewContext
{
  xMode: 'time',                          // 'time' | 'distance'
  zoomDomain: ['dataMin', 'dataMax'],     // Recharts domain, controlled
  enabledMetrics: ['pace','heartRate','cadence','power'],
  enabledStats: { pace:['avg'], heartRate:['avg','max'], cadence:[], power:[] },
  hoverIndex: null,                       // optional: for external readouts
}

// ActivityContext
{ activity: Activity|null, status: 'idle'|'loading'|'ready'|'error', error: Error|null, load(ref) }
```

`enabledStats` is per-metric on purpose: "avg heart rate" and "avg pace" are independently interesting, and a global stat toggle would clutter every panel at once.

---

## 11. Build order

1. `domain/types.js`, `domain/units.js` — types and formatters first; everything else references them.
2. `data/ActivitySource.js` + `MockActivitySource` + a JSON fixture. **Build the whole UI against the mock**, so the parser is never on the critical path. *(Historical: that is how this was built. The mock adapter and its fixture were deleted once the real parsers landed and the sample button that was their last caller went — see the last entry in §0. Test doubles are now inline `{kind:'mock', load}` objects passed to `AppProviders`.)*
3. `metrics/metricRegistry.js`, `stats/aggregate.js`, `stats/useMetricStats.js`.
4. `state/*`, `app/providers.jsx`.
5. `ui/MetricPanel.jsx` → `ui/ChartStack.jsx` with hardcoded enabled metrics. Verify axis alignment and `syncId` crosshair across 4 panels before adding controls.
6. `ui/ControlPanel.jsx`, toggles, stat checkboxes, x-axis mode switch.
7. `Brush` + controlled `zoomDomain` across all panels.
8. `data/tcx/parseTcx.js` + `TcxActivitySource`, then swap the provider from mock to TCX. Test with a real Garmin export containing pauses and at least one missing metric.
9. `domain/downsample.js` once a long activity (>2 h) feels sluggish.

**Definition of done for v1:** drop a TCX file, see ≥4 aligned synced panels, switch x-axis between elapsed time and distance, toggle any metric on/off, toggle max/min/avg/median lines per metric, brush-zoom all panels together, and have average pace match what Garmin Connect reports for the same file.

---

## 12. Known future seams (build for, don't build)

- **Swimming:** add to the `Sport` union; add `sports: [...]` filtering in the registry (cycling already does exactly this — see §6); swimming needs a `lengths`-based x-axis mode, which is why `xMode` is already an enum rather than a boolean.
- **~~API source~~ — built (§0).** `data/intervals/` implements `load({type:'id'})` against intervals.icu. What is genuinely still open on that path:
  - **OAuth.** Out of reach today: registration is an email to david@intervals.icu, *and* the token exchange needs a `client_secret`, which a static site cannot hold. It is the one thing that would flip the "no server-side code" answer — it would bring the Worker back purely to perform that exchange. intervals.icu's own docs say to use the API key for your own data, which is exactly this use case.
  - **A `/api/intervals/*` Worker pass-through**, as an escape hatch if intervals.icu ever narrows its CORS policy. The whole feature currently rests on that policy (§0), and this is the fallback if it changes.
  - **Write-back.** The same key already authorises `PUT`/`POST` — deliberately not built. This app is read-only against intervals.icu by design, and the connect form says so.
  - **Multi-account**, and **caching either read path** — today every visit to the view re-lists, and search is uncached too: one request per typing burst (debounced, ≥2 chars), and re-typing the same query re-requests it. At 1 call per list load, 1 per search burst and 1 per activity opened, still nowhere near the 5000/day, 2500/15min, ~10 req/s ceilings — which is why neither is cached yet.
  - **`GET /athlete/0/activities/interval-search`** — matching on `minSecs`/`maxSecs`, `minIntensity`/`maxIntensity`, `type`, `minReps`/`maxReps` rather than on name. Confirmed present in the spec and deliberately not built: it needs a real filter UI, not a text box, and the name/tag search covers the case that motivated searching at all. Likewise `/athlete/{id}/activity-tags` exists, but a tag *picker* is not wanted — `#tag` through the search box already reaches the same matching.
  - **Paging search results.** `ACTIVITY_SEARCH_LIMIT` is 30 and the endpoint offers no cursor, so a query matching more than 30 activities shows at most 30 with nothing saying more matched. Narrowing the query is the only recourse today.
  - **`Sport` gaps.** intervals.icu happily lists swims, walks and everything else; those rows are pickable and will fail at `parseFit`/`parseTcx`'s sport check with a real message. Widening the `Sport` union is the fix, not filtering the list.
- **Multi-activity overlay:** `ActivityContext` becomes a list; `MetricPanel` renders N `<Line>` per panel. The registry and stats layer need no change.
- **Laps:** parser already sees lap boundaries; surface them as `ReferenceArea` bands.
- **`gpxtpx:TrackPointExtension`** (`hr`, `cad`, `atemp`) and `pwr:PowerInWatts` — the cheapest of these and probably the most-used in practice: a Strava or Garmin *GPX* export carries heart rate and cadence, and without this those files get fewer panels than the same activity as TCX. ~20 lines inside `parseGpx`; nothing above it changes, since `RawTrackpoint` already has every field.
- **Temperature metric:** the TG-7's other real channel. `RawTrackpoint.temperatureC` → `Sample.temperature` → one `metricRegistry` entry → one `--metric-temperature` token. The registry exists for exactly this (§6).
- **KML:** SPOT and OI.Track both also export it. A separate parser, not a variant of `parseGpx` — `<gx:Track>` holds parallel `<when>` and `<gx:coord>` lists rather than per-point elements.
- **Wall-clock x-axis mode:** `XAxisMode` is already an enum for this reason. A multi-day track is the first data that really wants it. Touches `ChartViewContext`, `XAxisModeSwitch`, `Brush`, `SyncedTooltip`.
- **A real fixture containing a pause.** No fixture in the repo has one — that, not the arithmetic, is the root reason the `totalMovingTime` defect fixed on 2026-08-07 (§0) survived to be found by reading. The fix landed on synthetic tests; when a real paused Garmin export is available, add it. Prefer the **`.fit`** export: `sessionMesgs[0].totalTimerTime` is Garmin's own moving time (verified present — 1800.18 s in the current fixture, equal to `totalElapsedTime` because it has no pauses), which gives an exact oracle for `totalMovingTime` with no hand-written `meta.json`. `parseFit` does not read it today and **should not start** — production must stay derived so TCX and GPX behave identically — but a test may read it directly.
- **Activity title from `<trk><name>`:** GPX is the first format that carries a real free-text title. Routing it through the existing `sportLabel` seam is wrong — `deriveWorkoutName` prefixes a time-of-day bucket, so a Strava export would read "Morning Morning Run". It needs a real `Activity.title` seam separate from the inferred name.
- **Empty-state for an activity with no chartable channels:** it currently reaches `status: 'ready'` and renders a bare bordered box with no text. Not reachable via GPX (elevation or derived speed will essentially always exist), but a real hole.

---

## 13. Mobile UX adaptation routes (document, don't build)

The intervals.icu feature (§0) exists because the app was close to unusable on a phone — but it fixed the *data* route only. This section records what the *UI* would need, as routes rather than work: it was scoped out deliberately, and the findings below are the expensive part to rediscover.

**Facts as found, all of which must be preserved by any of the routes below:**

- There is **exactly one** `@media (max-width: 720px)` block (`src/styles/global.css`), and before this feature it adjusted padding and `.metric-control-row`'s direction and nothing else.
- `index.html` already carries a correct `<meta name="viewport" content="width=device-width, initial-scale=1.0">`. Nothing to do there.
- `.app` already uses `min-height: 100svh`, which is the right unit for iOS's collapsing address bar — `100vh` would leave a chart clipped behind it.
- The sticky header and its `app-header--faded` behaviour (scroll away, the load bar collapses and gives its space to the charts; hover or focus brings it back) is *more* valuable on a small screen, not less.

**Route A — panel heights. §9 promises "panel heights reduced ~25%" below 720px, and it was never implemented.** It cannot be done in CSS: the heights are JS constants in `src/ui/ChartStack.jsx` (`FIRST_PANEL_HEIGHT` 200, `OTHER_PANEL_HEIGHT` 140, `BRUSH_HEIGHT` 30) fed to `<ResponsiveContainer height>`. The route is a `useIsNarrow()` hook over `matchMedia`, mirroring the existing `useIsScrolled` in `App.jsx`. **Prerequisite: jsdom implements no `matchMedia` and `setupTests.js` has no stub for it** — and every chart test renders `ChartStack`, so that stub has to land *before* the hook does or the whole suite breaks at once.

**Route B — the `Brush` is not a touch target.** Its travellers are ~5px wide (far under the 44px floor), their drag handlers bind to `window`, and the gesture competes with page scroll. The cheapest real fix is explicit zoom/pan buttons — cheap *because* zoom is already a controlled `zoomDomain` (§7), which is the payoff of that earlier decision. A custom `traveller` render prop plus `touch-action: none` is the polish tier, not the starting point.

**Route C — the readout.** Touch has no hover, and a finger covers the very point it is reading. `ChartViewContext` already carries `hoverIndex`, described in §10 as "optional: for external readouts" — that is exactly this seam: a fixed value row above the stack instead of a floating tooltip.

**Route D — controls.** `.metric-control-row` already stacks below 720px; the next step is collapsing each metric's stat checkboxes into a `<details>` at that width.

**Route E — this feature is the mobile entry point, so its own UI already meets the bar.** Activity rows are real `<button>`s at `min-height: 44px` with their reason text visible rather than in a `title` tooltip (invisible on touch), and the API-key input is `font-size: 16px` **exactly** — below 16px, iOS Safari zooms the page on focus and the athlete has to pinch back out.
