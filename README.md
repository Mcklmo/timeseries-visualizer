# ActivityMaxxer

**[activitymaxxer.com](https://activitymaxxer.com)**

A web UI, in the spirit of Intervals.ICU / Garmin Connect, for inspecting a single running
or cycling activity — or a plain GPS track — as vertically stacked, time-synced charts
(pace/speed, heart rate, cadence, power, elevation) sharing one x-axis — elapsed time or
distance.

v1 scope is intentionally narrow: running, cycling and generic GPS tracks, metric units
only, single activity, no persistence, no auth. See [ARCHITECTURE.md](doc/ARCHITECTURE.md) for
the full design spec, build order, and rationale — this README is the practical "how do I
run/build this" doc.

## Status

This project is **functional end-to-end, including real Garmin file upload** — drop a
`.tcx`, `.fit` or `.gpx` export and it's parsed and charted for real. What exists today:

- Domain pipeline (`src/domain/`), stats/aggregation (`src/stats/`), the metric registry
  (`src/metrics/`), and the `ActivitySource` port are built and tested.
- State layer (`ActivityContext`, `ChartViewContext`, `AppProviders`) is built and tested.
- `ChartStack` / `MetricPanel` / `SyncedTooltip` render synced, aligned charts, verified
  against real rendered Recharts SVG output.
- `ControlPanel` and its children (`MetricToggle`, `StatCheckboxes`, `XAxisModeSwitch`) drive
  metric visibility, per-metric stat lines, and x-axis mode — also verified against real
  rendered Recharts SVG output, not just context state.
- Zooming is a **two-finger pinch** anywhere on the chart stack, or **ctrl/⌘ + scroll** on a
  desktop, writing one shared controlled `zoomDomain` so every panel zooms and pans in sync.
  Moving both fingers together pans, and on a desktop a **two-finger horizontal swipe**
  (or **Shift + scroll**) pans the zoomed window sideways at constant width; a **Reset
  zoom** button appears only while zoomed;
  switching x-axis mode resets the zoom (a numeric range in seconds is meaningless once
  re-read as metres). Verified by simulating real pointer sequences against rendered SVG
  output, not just calling the state setter directly. This replaced Recharts' `Brush`, whose
  ~5px drag handles were unusable on touch — see ARCHITECTURE.md §13 Route B.
- `App.jsx` is wired end-to-end: drop a file on the idle page's `EmptyState` hero (or on the
  compact control that takes its place in the header once something is loaded), watch
  `ActivityContext` cycle through `loading`, and land on `ControlPanel` + `ChartStack` (or
  `ErrorState`, with a "Try again" that replays the same load).
- The dark, chart-forward visual theme from ARCHITECTURE.md §9 is applied
  (`styles/tokens.css` + `styles/global.css`); the old default-Vite-template files
  (`App.css`, `index.css`, starter assets) are gone.
- The domain pipeline (`buildDistanceAxis`, `deriveSpeed`, `detectPauses`, `smooth`,
  `normalizeActivity`) and `data/tcx/` (`parseTcx` + `TcxActivitySource`) are built and
  tested, including a cross-check against a real Garmin export (see Testing notes below):
  computed average pace matches Garmin's own reported value to the second. `App.jsx`
  routes a dropped/browsed file to the real TCX, FIT or GPX parser by extension.
- **GPX** (`data/gpx/`) covers everything that isn't a training watch — satellite messengers
  (SPOT), cameras (OM System Tough TG-7 via OI.Track), phone apps. A GPX carries position,
  elevation and time and nothing else, so distance is reconstructed by haversine and speed
  from its deltas; a track with no `<trk><type>` gets a generic **Track** sport that shows
  speed rather than pace. The whole pipeline is **sampling-rate adaptive** for these: pause
  detection, speed smoothing and the x-axis tick format all scale off the recording's own
  median interval, so a breadcrumb every 10 minutes across three days charts honestly while
  1 Hz watch files behave exactly as they did (asserted, not assumed — see Testing notes).
- The footer's **Feedback** link opens a dialog that files a labelled GitHub issue on this
  repo via `POST /api/feedback`, guarded by Cloudflare Turnstile plus a native rate-limit
  binding. This is the project's only server-side code (`worker/`) — activity files are
  still parsed entirely in the browser and never uploaded anywhere. See "Feedback form
  configuration" under Deploying.
- **intervals.icu activity browser** (`data/intervals/` + `ui/Intervals*.jsx`) — paste an
  API key once and pick from your real activity history instead of hunting for a file. This
  is the phone route: a watch file syncs to Garmin Connect and there is no practical way to
  get it into a mobile browser, but intervals.icu already auto-syncs from Garmin and keeps
  the **original upload**, so the app downloads that and runs it through the same parsers a
  dropped file uses — Stryd power and all. It needed **no server-side code**: intervals.icu
  sends CORS headers, so the browser talks to it directly. See "Connecting intervals.icu"
  below.
- `downsample.js` is still unbuilt — not needed until there's an activity long enough to
  need downsampling. (The old `data/http/` source stub is gone: the real API hands back the
  original uploaded file rather than normalized samples, so the seam became `data/intervals/`
  — see ARCHITECTURE.md §0.)

Check the checklist at the top of [ARCHITECTURE.md](doc/ARCHITECTURE.md#0-implementation-progress)
for the up-to-date build status.

## Tech stack

- [React 19](https://react.dev/) + [Vite](https://vite.dev/), plain JS (JSDoc typedefs for
  shapes, no TypeScript build step for app code — `tsconfig*` only cover tooling)
- [Recharts](https://recharts.org/) for the synced line charts
- [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/react)
  + jsdom for tests

## Getting started

Requires Node `24.19.0` (see `.node-version`).

```bash
npm install
npm run dev       # start the Vite dev server
```

Other scripts:

```bash
npm run build       # tsc -b && vite build
npm run lint         # eslint .
npm run preview      # preview a production build
npm test             # vitest run (single pass)
npm run test:watch   # vitest, watch mode
```

### Dev server vs. local production preview

`npm run dev` and `npm run preview` serve different things — reach for `preview` before
shipping, since `dev` mode hides bugs that only show up once the code is minified/bundled.

- `npm run dev` — Vite dev server with hot module reload and unminified code. Use this for
  day-to-day development.
- `npm run build` then `npm run preview` — builds the real `dist/` bundle (the same output
  `wrangler deploy` uploads) and serves it locally, so you're testing what actually ships.
  Note `preview` serves the static assets only — `/api/feedback` doesn't exist here, so use
  `wrangler dev` below to exercise the feedback form:

  ```bash
  npm run build
  npm run preview -- --port 4173
  ```

  Open the printed URL (`http://localhost:4173` above) and click through the app as you
  would the deployed site — file upload/parsing in particular is worth re-checking here,
  since minification/tree-shaking can occasionally break something `dev` mode wouldn't catch.

### Testing the Cloudflare deploy locally (`wrangler dev`)

Deployment runs through Wrangler (see `wrangler.jsonc` and the Deploying section below), not
plain static hosting, so it's worth a local pass through Wrangler's own runtime before
pushing — it's the closest local simulation of the actual Cloudflare environment, and the
only one that runs the Worker, so it's the **only** way to exercise `/api/feedback` locally:

```bash
cp .dev.vars.example .dev.vars   # first time only, then fill in a real GITHUB_TOKEN
npm run build
npx wrangler dev
```

Open the printed URL (defaults to `http://localhost:8787`). This serves `dist/` and runs
`worker/index.js` through the same Workers runtime Cloudflare uses in production, so it also
catches any `wrangler.jsonc` misconfiguration (e.g. a wrong `assets.directory`, a missing
binding) before it reaches a real deploy.

## Connecting intervals.icu

Optional, off by default, and the reason the app is usable on a phone at all: your watch
file syncs to Garmin Connect, and there is no practical way to get it from there into a
mobile browser. intervals.icu already auto-syncs from Garmin Connect and keeps the
**original uploaded file**, so the app uses it as a bridge.

**Where the key comes from.** In intervals.icu, open **Settings**, scroll to the bottom, and
find **Developer Settings**. Paste the key into the app's *intervals.icu* view. It's checked
against your profile before anything is stored, so a typo can't leave you half-connected.

**What you're handing over.** The key is a **password, not a session token**: it is
unscoped — the same credential grants full **read *and write*** access across your whole
intervals.icu account — it never expires, and the only way to revoke it is to regenerate it
in Developer Settings. This app only ever reads, but the key itself doesn't know that.

**Where it lives.** In this browser's `localStorage`, until you press **Disconnect**.
Disconnect removes it locally; it does **not** revoke it upstream. Anything with script
access to the origin can read `localStorage`, so treat a shared or borrowed device
accordingly.

**Where it goes.** Only to intervals.icu. Requests go browser → `https://intervals.icu`
directly; nothing — not the key, not your activities — passes through this app's Worker,
which serves nothing but the page. This works because intervals.icu's API sends CORS
headers, which is why the feature needed no server-side code at all.

**Finding an activity.** The list itself shows a rolling window of recent activities, widened
backwards by **Load earlier activities**. The search box above it does not search that window —
it searches your **whole intervals.icu history** by activity name, from two characters up, as
you type. A query starting with `#` is an exact **tag** search instead (`#threshold` finds
everything tagged `threshold`). Clearing the box drops straight back to the list you were
browsing, exactly where you left it.

**Consequences worth knowing:**

- Because there's no Worker route involved, `npm run dev` alone is enough to develop and
  test this — unlike the feedback form, which needs `npx wrangler dev`.
- Search returns at most 30 matches and there's no "show more" — narrow the query if what
  you want isn't there. Nothing is cached, so the same search runs again next time.
- **Strava-synced activities can't be downloaded.** intervals.icu doesn't keep an original
  file for them. Those rows appear in the list, disabled, with that as the stated reason —
  they're shown rather than hidden so a missing activity doesn't read as a bug.
- What you get is the *original* file, so it carries everything the file carries — including
  Stryd power from a FIT developer field, which Garmin Connect's own TCX export drops. It is
  not, however, byte-identical to a manual Garmin Connect export: Garmin filters some
  session-level summary fields (VO2max, recovery time) out of its API. Per-record telemetry,
  which is everything this app charts, comes through intact.

## Project structure

```
src/
  App.jsx     # composition root: AppShell (by ActivityContext.status) + AppProviders
  app/        # composes ActivitySourceProvider + ActivityProvider + ChartViewProvider
  data/       # ActivitySource port + adapters: tcx, fit, gpx (files) and intervals
              # (the intervals.icu bridge — the only data path that touches the network)
  domain/     # pure, framework-free normalization pipeline (types, units, buildDistanceAxis,
              # deriveSpeed, detectPauses, smooth, samplingInterval, insertGapBreaks,
              # normalizeActivity)
  lib/        # feedbackClient — the browser side of POST /api/feedback
  stats/      # max/min/avg/median aggregation, strategy-aware, memoized hook
  metrics/    # metricRegistry — the extension point for adding metrics/sports
  state/      # ActivityContext, ChartViewContext
  ui/         # ChartStack, MetricPanel, SyncedTooltip, ControlPanel + toggles/switch,
              # EmptyState, ErrorState, FileDropZone,
              # IntervalsPage/ConnectForm/ActivityList + useDebouncedValue,
              # FeedbackWidget/Dialog/Form + useTurnstile
  styles/     # tokens.css (dark theme + metric hues), global.css (layout, chrome)
scripts/
  build-seo-pages.mjs  # runs after `vite build`: emits the static landing pages,
                       # sitemap.xml and robots.txt into dist/ (see "Static pages")
  seo/pages.mjs        # their content, as plain data — including the About prose
  seo/pages.test.mjs   # the content rules, enforced rather than reviewed
shared/       # environment-agnostic values imported by BOTH src/ and worker/ (feedbackLimits)
worker/       # the Cloudflare Worker: routes /api/feedback, serves dist/ via env.ASSETS
  routes/     # feedback.js — the request orchestration
  lib/        # validateFeedback, buildIssuePayload, verifyTurnstile, githubClient, rateLimit
fixtures/
  activity_23870166877.tcx               # real Garmin export, used by the parser cross-check test
  activity_23870166877-meta.json         # Garmin's own reported stats for that export
  23870166877_ACTIVITY.fit               # the same activity as FIT (carries Stryd power)
  activity_23870166877.gpx               # ...and as GPX: same run reduced to lat/lon/ele/time
  sparse-multiday.gpx                    # hand-built SPOT X shape: 10-min breadcrumbs over 3 days
```

The dependency rule: `domain/` imports nothing from `ui/`, `data/`, or React; `data/`
imports `domain/` types only. This is what lets a future HTTP `ActivitySource` replace TCX
file upload without touching any component. `shared/` extends it across the client/server
line: plain values only, importable by both `src/` and `worker/`, which never import each
other. See ARCHITECTURE.md §3–§6 for the full layer diagram and the metric registry
contract.

## Static pages (`/about` and the format landing pages)

Four pages on this site are **not** the React app: `/about`, `/fit-file-viewer`,
`/tcx-file-viewer` and `/gpx-viewer`. They are plain HTML with zero JavaScript, written by
`scripts/build-seo-pages.mjs`, which `npm run build` runs *after* `vite build` — it has to
come second, because Vite empties `dist/` and because the script links the CSS bundle Vite
just produced. That link is **globbed**, never hardcoded: the content hash changes every
build, and a stale href means an unstyled page rather than an error.

Their content lives in `scripts/seo/pages.mjs` as plain data. Editing prose means editing
that file — including the About prose, which no longer exists as a React component. The
header's About control is a real `<a href="/about">`, so it navigates; under `npm run dev`
it will 404, since Vite's dev server does not serve `dist/`. Use `wrangler dev` to click
through them.

Three things about this are load-bearing and easy to undo by accident:

- **`scripts/seo/pages.test.mjs` fails the suite on thin or duplicated copy** — under 400
  words of body, or two pages whose vocabulary overlaps too far. Five pages differing only
  in a filename are doorway pages: search engines filter them, and the site ends up worse
  off than with one good page. The test is the rule, not a comment about it.
- **Do not set `not_found_handling: "single-page-application"`** in `wrangler.jsonc`. It is
  the tempting default once you add routes, and it would answer every typo'd URL with 200 +
  the app shell — soft 404s at scale. Real 404s are correct and already work; nothing else
  in the assets config needs changing, since the default `auto-trailing-slash` handling
  already serves `about.html` at `/about`.
- **Do not add an analytics script.** `/about` states there is none, and search performance
  is measured through Search Console, which reports from Google's own crawl logs and puts
  no code on the page. Adding one makes that page a lie.

`sitemap.xml` and `robots.txt` are generated from the same page list, so they cannot fall
out of sync with what actually exists.

## Testing notes

### Automated: unit + system tests

```bash
npm test             # vitest run — unit + system tests, single pass
npm run test:watch   # same, watch mode
```

"System" here means component tests that render through `AppProviders` and assert against
actual rendered Recharts SVG output (parsed path/line coordinates, `.recharts-*` DOM), not
just component props or context state — see `ControlPanel.test.jsx` and `App.test.jsx` for
examples, and ARCHITECTURE.md §0 for the jsdom pitfalls that motivated this approach.

- `src/setupTests.js` stubs `ResizeObserver` and provides a fixed `getBoundingClientRect`
  (jsdom reports 0×0 otherwise, which collapses Recharts' `ResponsiveContainer`), stubs
  `<dialog>`'s `showModal`/`close` (still unimplemented in jsdom 30), and calls
  `afterEach(cleanup)` explicitly since this project doesn't enable Vitest's `globals`.
- The Worker's tests (`worker/**/*.test.js`) run in the same single Vitest config, on Node's
  native `fetch`/`Request`/`Response`. Pure functions get plain input/output tests; the two
  modules that call out (`verifyTurnstile`, `githubClient`) take an injected `fetchImpl`; and
  `worker/routes/feedback.test.js` stubs `globalThis.fetch` *routed by URL* (siteverify vs.
  the GitHub API) so it exercises the real chain end-to-end rather than mocking the lib
  modules it is supposed to be integrating.
- Chart tests assert against actual rendered SVG (parsed path/line coordinates), not just
  component props — see ARCHITECTURE.md §0 for the jsdom pitfalls that motivated this.
- `TcxActivitySource.realGarminFixture.test.js` parses a real Garmin export
  (`fixtures/activity_23870166877.tcx`) end-to-end and asserts the computed average pace,
  total distance, and total time against Garmin's own reported values for that same file
  (`fixtures/activity_23870166877-meta.json`) — the strongest check available that
  `weightedPace` (ARCHITECTURE.md §6) is actually correct, not just internally consistent.
  Drop your own `.tcx` export in `fixtures/` with a sibling `-meta.json` (see that file for
  the shape) to add another real cross-check.
- `FitActivitySource.realGarminFixture.test.js` and `GpxActivitySource.realGarminFixture.test.js`
  do the same for the *same activity* in the other two formats, which is what makes them
  comparable. The GPX one uses a deliberately looser 3% distance tolerance: with no
  `<DistanceMeters>` in the file, distance is summed from great-circle hops between noisy
  per-second fixes, which overestimates by ~0.9% against Garmin's own figure. Quantifying
  that drift is the point of the test.
- `GpxActivitySource.sparse.test.js` runs `fixtures/sparse-multiday.gpx` — 10-minute
  breadcrumbs over three days with a 6-hour dropout — end-to-end. It is the regression net
  for the sampling-rate adaptivity: before it, every sample past the first counted as
  paused and the activity averaged `0:02 min/km`.
- `IntervalsActivitySource.realGarminFixture.test.js` is the fourth route to that *same*
  activity: the `.fit` fixture **gzipped and served through a stubbed `fetchImpl`**, exactly
  as intervals.icu's `/activity/{id}/file` serves an original upload. It asserts the same
  distance, duration and avg pace — and that `availableMetrics` includes `power`. One
  activity, four routes, identical numbers: that is the proof the network path reaches full
  original-file fidelity rather than a downgraded re-export.
- Everything under `src/data/intervals/` is **fully testable offline** — no key and no
  network, via an injected `fetchImpl` throughout. `App.test.jsx` also pins the privacy
  stance mechanically: one test renders `<App />` with `globalThis.fetch` stubbed to throw
  and asserts it is never called, at boot *or* on the dropped-file path.

### Manual testing walkthrough

The automated suite already asserts against real rendered Recharts SVG output, but it's
still worth eyeballing the app after UI changes — some regressions (alignment, contrast,
responsive collapse) only show up visually. There's no manual step for the loading state
with the real sources (both resolve too fast to reliably observe by hand) or the error
state from a *rejected* load — those are only exercised by `App.test.jsx` against a
controlled source double. Dropping a malformed file is a real, manually-triggerable error
path, though (see step 9 below).

1. **Start the dev server** — `npm run dev`, then open the printed URL.
2. **Empty state** — page loads to a dark-themed "Load an activity" hero filling the page
   body: a large dashed drop target ("Drop a TCX, FIT or GPX file here / or click to
   browse") with the "never leaves your device" hint under it, then a quieter outlined
   "Load from intervals.icu" button below. The header holds the title on the left and, on
   the right, an *intervals.icu* button and an **About link** (a real `<a href="/about">`,
   not a view swap — it navigates to a static page, so `npm run dev` alone will 404 on it;
   use `wrangler dev` to click it) — no second **drop zone** anywhere while the hero is up.
3. **Load an activity** — drag a real export onto the hero (or click to browse and pick
   one), e.g. `fixtures/activity_23870166877.tcx`; dragging over it should tint the border.
   The hero should be replaced by a control panel (Time/Distance switch + one row per metric
   the file actually has — each with a colored dot, a checkbox, and max/min/avg/median
   checkboxes) and the stacked line charts below it — and the compact drop control should
   now appear in the header, so a *different* activity can be loaded without leaving this
   view. The header's left-hand cluster should now read
   `⚡ ActivityMaxxer  <name> [Running] 1 Jan 2026, 09:00 · 30:00` — the activity's identity,
   pinned there rather than in the page body. Scroll down: the drop control and the two
   links fade away, that cluster stays, legible over chart ink inside one translucent chip.
   Hover the header — everything comes back, and the chip must not double-darken.
4. **Synced crosshair/tooltip** — hover anywhere over any chart. Expect a vertical crosshair
   and tooltip at the same x-position on *all* panels, with the tooltip header always showing
   both elapsed time and distance regardless of mode.
5. **Metric toggles** — uncheck "Cadence" → its panel disappears, others stay aligned.
   Re-check it → it comes back.
6. **Stat reference lines** — check "Heart rate max" → a dashed line + label appears in the
   heart-rate panel only. Uncheck "avg" on any metric → its solid reference line disappears.
7. **X-axis mode** — click **Distance** → the bottom axis ticks switch from seconds to
   metres on every panel. Click **Time** to switch back.
8. **Zoom** — hold **Ctrl** (or ⌘) and scroll over the charts, or pinch on a trackpad → all
   panels zoom to the same range together, anchored under the cursor, and the crosshair keeps
   tracking. A **Reset zoom** button appears at the top-right of the stack only while zoomed;
   click it to go back to the full range. **The header's duration must follow the window** —
   it drops to the window's span, settling a frame behind the line exactly like the stat
   chips; cross-check it against the x-axis end labels, and confirm the date beside it does
   *not* move (that is the activity's identity, not the window's). On the **Distance** axis,
   zoom again: the duration is still a *time*, now for the distance window. "Reset zoom"
   restores the activity's total. Zoom in hard and check the line **clips at the plot
   edge** rather than bleeding into the axis gutter — that clipping is `allowDataOverflow`,
   and its absence is the tell that the numeric-domain path has regressed (ARCHITECTURE.md
   §7). Scroll **without** Ctrl → the page scrolls normally and a centred "Use Ctrl + scroll
   to zoom" hint appears **once**, not on every scroll past the charts. While zoomed, switch
   Time ⇄ Distance → zoom should reset to full range (not carry over a stale numeric range).
   Then, still zoomed, **swipe two fingers left and right** (or hold **Shift** and scroll) →
   all panels slide together at a window width that never changes, the crosshair keeps
   tracking, and the pan **stops dead** at both ends with no rubber-banding and — the trap
   worth checking every time — **no browser back-navigation** throwing the activity away.
   Scroll vertically over a zoomed chart → the page scrolls and the window must not drift
   sideways with it. Swipe sideways while **unzoomed** → nothing happens, and again the
   browser does not navigate back. Ctrl + a diagonal scroll → still zooms, never pans.
9. **Swap and error paths** — with charts up, drop `fixtures/23870166877_ACTIVITY.fit` on the
   **header** control → it swaps to the FIT activity (a Power panel appears, since the FIT
   file carries Stryd power the TCX export drops). Then drop a non-TCX file (or a `.tcx` with
   invalid XML) to see the error state — `ErrorState` shows the parser's specific message,
   and **Try again** re-runs the same file.
10. **GPX, same activity** — drop `fixtures/activity_23870166877.gpx`: chip reads
    **Running**, panels are Pace + Elevation only (no heart rate/cadence — GPX carries
    neither), and avg pace reads ≈ 6:19/km against the TCX file's 6:22, the ~1% haversine
    overestimate. Then re-drop the `.tcx` and `.fit` and confirm both look exactly as they
    did before — that is the no-regression check for the sampling-rate changes.
11. **GPX, sparse and multi-day** — drop `fixtures/sparse-multiday.gpx`: chip reads
    **Track**, the name reads **"3-day Track"**, panels are Speed + Elevation, the x-axis
    ticks read `0h · 1d0h · 2d0h` (not `259200`), avg speed is a plausible walking figure,
    and **both lines break visibly** at the 6-hour dropout and at each of the three nights
    in camp rather than running a straight diagonal across them. Hover anywhere: the
    tooltip header shows elapsed time in days (e.g. `2d 4:15:30`). Ctrl+scroll into one day
    and confirm the crosshair still syncs across both panels, the ticks stay real dates
    rather than `NaN`, and the zoom doesn't hit its floor prematurely — the max-zoom limit is
    a fraction of the span, so a 3-day breadcrumb track zooms exactly as far as a 1 Hz watch
    file does.
12. **GPX with no timestamps** — drop any route/waypoint `.gpx` (a planned route exported
    from a mapping app, or hand-edit a copy of a fixture to remove every `<time>`): expect
    the specific "looks like a route or waypoint list, not a recorded track" error, not the
    generic empty-file one.
13. **intervals.icu, with a real key** — needs only `npm run dev`; this feature adds **no**
    Worker route, unlike the feedback form below. Open the *intervals.icu* view and paste a
    key from Settings → Developer Settings.
    - The list shows real recent activities in descending date order, **including one from
      today** — that is the check that the `newest`-excludes-its-own-day gotcha is handled.
    - Open a Garmin-recorded run with Stryd power → charts render, a **Power** panel appears,
      and the header shows intervals.icu's *real* activity title rather than a derived
      "Morning Run". Cross-check avg pace against Garmin Connect, as the fixture tests do.
    - **Search** — type part of a workout name from *outside* the loaded window (something
      older than ~90 days, without pressing "Load earlier"): it should appear. Then `#` plus
      a tag you actually use → exact tag matches. Clear the box → the original windowed list
      is back untouched and "Load earlier activities" still widens it correctly. Note the
      button is **absent** while searching, deliberately — there is no window under the hits.
    - In DevTools → Network while searching: **one** `search-full` request per typing burst,
      not one per keystroke. Then type fast enough to overlap two requests and confirm the
      rows on screen match the *final* query, not whichever answer arrived last. A one-letter
      query should issue nothing at all.
    - Open a search hit → it loads and charts like any other row (same `{type:'id'}` path).
    - Reload → still connected. **Disconnect** → the key is gone from `localStorage` (check
      in DevTools → Application), the list is gone, and the app still works fully for
      dropped files.
    - Paste a deliberately wrong key → a clear "didn't accept that API key" message, and
      nothing persisted.
    - DevTools → Network: requests go to `intervals.icu` **only**, and dropping a local file
      issues **zero** network requests.
14. **Responsive layout** — narrow the window below ~720px → the hero and header should both
    stay readable with no horizontal overflow, each metric's toggle + stat-checkboxes row
    should stack instead of staying side-by-side, **"Chart settings" should be collapsed**
    (tap it to open; it stays open), and panel heights should drop ~25%. In the intervals.icu
    view, activity rows should be comfortable thumb targets, and focusing the API-key field
    **or the search box** must **not** zoom the page on an iPhone.
15. **On a real phone — the acceptance test for the mobile work, and it cannot be done in the
    simulator alone.** Run `npm run dev -- --host` and open the printed LAN URL on an iPhone.
    - **Gestures:** two-finger pinch zooms; moving both fingers together pans; a one-finger
      vertical drag still scrolls the page; and the browser never page-zooms while the
      gesture starts on a chart. (Known limit: a pinch *starting* on the control panel still
      page-zooms — `touch-action` only governs gestures whose touches start in the element.)
    - **Screenshots, the whole point of the frame work:** scroll down mid-activity and take
      one. It must show, in one translucent chip in the upper left, the bolt +
      "ActivityMaxxer" on the first row and the activity name, sport chip, start date/time
      and duration wrapped onto a second — the wordmark **not** dropped, the name **not**
      truncated, all of it legible against chart ink — then charts filling the rest, no
      half-collapsed chrome, no horizontal overflow, and a **dark** Safari address bar.
      Repeat at the top of the page and while zoomed in (where the duration should read the
      window's span, not the activity's) — **all three should be sharable as-is**.
16. **Feedback dialog** — needs `wrangler dev`, not `npm run dev`, since the API route only
    exists in the Worker. Click **Feedback** in the footer → a modal opens with subject /
    message / optional email, a "this opens a public issue on GitHub" notice, a Turnstile
    widget, and a **Send feedback** button that stays disabled until the challenge is
    solved. Submit → expect "filed as issue #N" with a working link, and a real issue in
    `Mcklmo/timeseries-visualizer` labelled `feedback`, whose body carries the message plus
    page URL / timestamp / user agent. Then check the failure paths: submit with the fields
    empty (expect inline per-field errors, not a banner), and submit ~6 times in a minute
    (expect the "too many submissions" banner).
17. **Escape closes the dialog** — press `Esc` with the feedback dialog open. This is native
    `<dialog>` behaviour that jsdom does not simulate, so it is *only* covered here, never
    by the automated suite. Re-opening afterwards should show empty fields, not the previous
    attempt.
18. **Static pages** — needs `wrangler dev`, since these are files in `dist/` rather than
    app views. Click **About** in the header: it should *navigate* to `/about`, arriving on
    a dark prose page that looks like it belongs to the app (it links the same CSS bundle),
    with the bolt lockup top-left linking back to `/` and an "Open a file →" control
    top-right. Follow the footer links round `/fit-file-viewer`, `/tcx-file-viewer` and
    `/gpx-viewer` and back into the app. Then check the two properties that are easy to
    break and invisible from the page itself:
    `curl -sI localhost:8787/nope` must still be **404** (not the app shell), and
    `curl -s localhost:8787/sitemap.xml` must list all five URLs.

## Deploying (Cloudflare Workers)

Deployment is a **Worker with static assets** (`wrangler.jsonc`), not Cloudflare Pages: one
Worker serves both `dist/` and the `/api/feedback` route the feedback form posts to. The
old Pages dashboard "Connect to Git" flow is gone on purpose — it has no concept of
`wrangler.jsonc`'s `main`/`assets.binding`/`ratelimits`, so it cannot serve that route at
all.

One-time setup, by whoever owns the Cloudflare account:

```bash
npx wrangler secret put GITHUB_TOKEN          # fine-grained PAT, this repo only, "Issues: write"
npx wrangler secret put TURNSTILE_SECRET_KEY  # secret half of the Turnstile widget
```

Then, for every deploy:

```bash
npm run deploy   # == npm run build && wrangler deploy
```

The site serves from **https://activitymaxxer.com** and nowhere else. Both halves of that
live in `wrangler.jsonc`, not the dashboard: `routes` attaches the apex as a custom domain
(Cloudflare provisions the DNS record and certificate itself, which needs the zone's
nameservers delegated to Cloudflare), and `"workers_dev": false` retires the
`*.workers.dev` hostname. Keep them together — two hostnames serving the same bytes is a
duplicate-content split, and toggling workers.dev off in the dashboard alone is undone by
the next deploy. Auto-deploy-on-push is deliberately out of scope — this is the manual flow.

No `base` path needs setting in `vite.config.ts` — the Worker serves from the domain root
(unlike GitHub Pages, which would need a repo-subpath `base` if used instead).

### Feedback form configuration

> Setting this up for the first time? [doc/FEEDBACK_SETUP.md](doc/FEEDBACK_SETUP.md) is the
> ordered walkthrough — creating the Turnstile widget and the GitHub token, the build-time
> vs. runtime trap that makes the *second* deploy the one that matters, and the browser
> checks to run afterwards. This section is the reference for what the values are.

The footer's **Feedback** link opens a dialog that files a labelled GitHub issue on this
repo. It needs four values, split by whether they're secret:

| Name | Where | Secret? |
| --- | --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | `.env` (committed) | No — a Turnstile *site* key ships in the page HTML |
| `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` | `wrangler.jsonc` `vars` | No |
| `TURNSTILE_SECRET_KEY` | `wrangler secret put` / `.dev.vars` | **Yes** |
| `GITHUB_TOKEN` | `wrangler secret put` / `.dev.vars` | **Yes** |

For local development, copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill it in.
The committed defaults are Cloudflare's published "always passes" Turnstile **test** pair
(sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`), which is
correct for local work and fails *closed* in production: a token minted by the test sitekey
does not verify against a real secret, so forgetting to swap `.env` gets submissions
rejected rather than waved through.

Abuse protection is two layers: Turnstile is the "is this a human" gate, and Cloudflare's
native Rate Limiting binding (`FEEDBACK_RATE_LIMITER`, 5 requests / 60s keyed on
`CF-Connecting-IP`) caps the blast radius of a replayed token behind it. The binding needs
no dashboard provisioning — its `namespace_id` only has to be unique within the account.

## Contributing / continuing the build

If you're picking this up (human or agent), read
[ARCHITECTURE.md](doc/ARCHITECTURE.md) first — §11 gives the build order, §0 tracks what's
done, and §12 lists seams that are deliberately designed for but not yet built
(multi-activity overlay, laps).
