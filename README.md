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
- `ChartStack` / `MetricPanel` / `CrosshairReadout` render synced, aligned charts, verified
  against real rendered Recharts SVG output. The crosshair's readout is **fixed at each
  graph's upper left** rather than following the cursor: one shared crosshair updates every
  graph's label in place, and the elapsed time and distance are reported once, in the sticky
  app header beside the activity's name and duration — so the reading stays in view however
  far down the stack you have scrolled.
- The chart's controls live where what they act on is: `ChartToolbar` holds the two that
  belong to no single graph (`XAxisModeSwitch`, `MetricToggle`), while each graph's
  `max/min/avg/median` and derivative boxes (`StatCheckboxes`) fold out of that graph's own
  head — also verified against real rendered Recharts SVG output, not just context state.
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
  `ActivityContext` cycle through `loading`, and land on `ChartStack` — which carries its own
  chrome now — (or `ErrorState`, with a "Try again" that replays the same load).
- The dark, chart-forward visual theme from ARCHITECTURE.md §9 is applied
  (`styles/tokens.css` + `styles/global.css`); the old default-Vite-template files
  (`App.css`, `index.css`, starter assets) are gone.
- The domain pipeline (`buildDistanceAxis`, `deriveSpeed`, `detectPauses`, `smooth`,
  `normalizeActivity`) and `data/tcx/` (`parseTcx` + `TcxActivitySource`) are built and
  tested, including a cross-check against a real Garmin export (see Testing notes below):
  computed average pace matches Garmin's own reported value to the second.
  `data/sourceRegistry.js` routes a dropped/browsed file to the real TCX, FIT or GPX parser
  by extension — and, when the name says nothing useful, by **sniffing the bytes**, gunzipping
  first if needed. So a `.fit.gz` straight out of a bulk export opens, rather than reaching
  the XML parser and dying on "invalid XML".
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
  binding. This was the project's only server-side code (`worker/`) until the Strava route
  below — a **dropped file** is still parsed entirely in the browser and never uploaded
  anywhere, which is the claim the app actually makes. See "Feedback form configuration"
  under Deploying.
- **intervals.icu activity browser** (`data/intervals/` + `ui/Intervals*.jsx`) — paste an
  API key once and pick from your real activity history instead of hunting for a file. This
  is the phone route: a watch file syncs to Garmin Connect and there is no practical way to
  get it into a mobile browser, but intervals.icu already auto-syncs from Garmin and keeps
  the **original upload**, so the app downloads that and runs it through the same parsers a
  dropped file uses — Stryd power and all. Find an activity by name search across your whole
  history, or by date range — presets plus two day fields, narrowing the request itself rather
  than paging back a window at a time. It needed **no server-side code**: intervals.icu sends
  CORS headers, so the browser talks to it directly. See "Connecting intervals.icu" below.
- **Strava activity browser** (`data/strava/` + `ui/Strava*.jsx` + `worker/routes/strava.js`)
  — the second network route in, and the one that closes the hole the row above documents
  against itself: intervals.icu keeps no original file for a Strava-synced activity, so those
  rows have always been listed and disabled. Connect Strava directly and they open. There is
  no original-file endpoint on Strava's side either, so this adapter is the first that builds
  `RawTrackpoint[]` itself, out of the streams API — everything below `data/` is shared with
  the file parsers unchanged. **Unlike intervals.icu it does route through the Worker**, and
  that is not optional: Strava's OAuth needs a `client_secret` that cannot live in a web page.
  See "Connecting Strava" below.
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
  Note `preview` serves the static assets only — neither `/api/feedback` nor `/api/strava/*`
  exists here, so use `wrangler dev` below to exercise the feedback form or Strava:

  ```bash
  npm run build
  npm run preview -- --port 4173
  ```

  or

  ```bash
  npm run build && npx wrangler dev
  ```

  Open the printed URL (`http://localhost:4173` above) and click through the app as you
  would the deployed site — file upload/parsing in particular is worth re-checking here,
  since minification/tree-shaking can occasionally break something `dev` mode wouldn't catch.

### Testing the Cloudflare deploy locally (`wrangler dev`)

Deployment runs through Wrangler (see `wrangler.jsonc` and the Deploying section below), not
plain static hosting, so it's worth a local pass through Wrangler's own runtime before
pushing — it's the closest local simulation of the actual Cloudflare environment, and the
only one that runs the Worker, so it's the **only** way to exercise `/api/feedback` **or the
whole Strava route** locally. `npm run dev` cannot reach either:

```bash
cp .dev.vars.example .dev.vars   # first time only, then fill in a real GITHUB_TOKEN
                                 # and STRAVA_CLIENT_SECRET (the localhost app's — see
                                 # "Connecting Strava" for why there are two apps)
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
directly; nothing — not the key, not your activities — passes through this app's Worker.
This works because intervals.icu's API sends CORS headers, which is why *this* provider
needed no server-side code at all. It is scoped to intervals.icu, and it is not a claim
about the app as a whole: the Worker also serves `/api/feedback`, and the Strava route
below deliberately does go through it.

**Finding an activity.** The list shows the **last 90 days**, widened backwards another 90 days
each time you press **Load earlier activities**. The search box above it does not search that
window — it searches your **whole intervals.icu history** by activity name, from two characters
up, as you type. A query starting with `#` is an exact **tag** search instead (`#threshold` finds
everything tagged `threshold`). Clearing the box drops straight back to the list you were
browsing, exactly where you left it.

**Filtering by date.** Under the search box are three one-tap presets (30 days, 3 months,
12 months) and a **From** / **To** pair. The filter is **on from the start**: *3 months* reads as
pressed and both fields are already filled with the last 90 days, so "Load earlier activities" is
just the **From** field stepping backwards. Both ends are inclusive: *1 Mar → 31 Mar* includes
everything recorded on both days. **↺** puts the last 90 days back, and shows up only once the
range differs from them — there is no "filtering off" state, though you can still empty either
field by hand. Whatever range you leave it on is remembered **for that browser tab**: reload and
it comes back (and the first request already uses it), open a new tab and you start at the last
90 days again. Nothing flashes on the way: the activities you had already loaded stay on screen
while the wider window reloads behind them. The range narrows search results
too, but only the ones the search already returned:
that endpoint accepts no dates, so it hands back the 30 best name matches from your whole
history and the range is applied to those. A search that comes up empty under a range may still
have older matches — widen the range or narrow the query.

**Consequences worth knowing:**

- Because there's no Worker route involved **on this provider**, `npm run dev` alone is
  enough to develop and test it — unlike the feedback form and the whole Strava route, both
  of which need `npx wrangler dev`.
- Search returns at most 30 matches and there's no "show more" — narrow the query if what
  you want isn't there. Nothing is cached, so the same search runs again next time.
- **Strava-synced activities can't be downloaded.** intervals.icu doesn't keep an original
  file for them. Those rows appear in the list, disabled, with that as the stated reason —
  they're shown rather than hidden so a missing activity doesn't read as a bug. Connecting
  Strava directly (below) is what opens them. The one exception is a row that arrives with
  **no date at all** (some Strava rows are near-empty stubs): it can't honestly be placed
  inside a date range, so the date filter drops it. Empty both date fields to see those rows
  again.
- What you get is the *original* file, so it carries everything the file carries — including
  Stryd power from a FIT developer field, which Garmin Connect's own TCX export drops. It is
  not, however, byte-identical to a manual Garmin Connect export: Garmin filters some
  session-level summary fields (VO2max, recovery time) out of its API. Per-record telemetry,
  which is everything this app charts, comes through intact.

## Connecting Strava

Optional and off by default, like intervals.icu, and it exists for two reasons: it is the
second phone route in, and it opens the activities intervals.icu can only list.

**How you connect.** Press **Connect with Strava** and you land on Strava's own consent
page. Approve, and Strava sends you back to `/` with a one-time code the app trades for
tokens. There is nothing to paste and no password to hand over.

**What you're granting.** `activity:read_all` — read-only, and `_all` rather than plain
`activity:read` because the narrower scope silently excludes private activities, and "my run
isn't in the list" is a confusing failure that looks like a bug here. Strava's consent
screen lets you untick the private-activity half; the app checks the *granted* scope on the
way back and says so rather than showing a mysteriously short list.

**Where the tokens live.** In this browser's `localStorage`, same as the intervals.icu key
and for the same phone-shaped reason. The trade is genuinely better on this side, and it's
worth stating plainly: a Strava access token is scoped read-only, expires after six hours,
and — unlike an intervals.icu key — **is really revocable from inside this app**.
**Disconnect** calls Strava's `/oauth/deauthorize`, so the grant is gone upstream, not just
locally.

**Where it goes — this route does touch the server.** Requests go browser →
`/api/strava/*` on this app's Worker → Strava. That is not a preference: the OAuth exchange
and every six-hourly refresh require a `client_secret`, which cannot live in a web page, and
Strava's CORS headers on the streams endpoint have disappeared and returned more than once.
The Worker is **stateless** — it holds the secret, forwards your bearer token upstream and
hands Strava's response back verbatim. It stores nothing, logs nothing and has no database.
The honest cost, stated because it is real: your token transits it in a request header and
your telemetry in a response body, over same-origin HTTPS.

**The 10-athlete cap.** Strava's Standard Tier caps a developer app at **10 connected
athletes** and the app doesn't have Extended Access. Athlete 11 gets a specific message
saying the app is full, not a generic auth failure. This is a limit on this app, not on your
account.

**What gets cached.** An activity's streams are held in memory (at most 8 of them), so
reopening one or pressing "Try again" costs no request; the activity list is held in
`sessionStorage` for 15 minutes. Both evaporate when the tab closes, which is what makes
Strava's API Policy §6.3 and §7.4 deletion obligations automatic rather than something this
app has to implement — and Disconnect clears both explicitly before deauthorizing.

**Consequences worth knowing:**

- **This feature needs `npx wrangler dev`, not `npm run dev`.** Nothing about it works
  against the Vite dev server alone, because `/api/strava/*` does not exist there.
- **A Strava app has exactly one Authorization Callback Domain**, so one app cannot serve
  both `activitymaxxer.com` and `localhost` — there are two registered. The production id is
  in the committed `.env`; put the dev app's in a gitignored `.env.local` and its secret in
  `.dev.vars`. Both files carry a cross-reference comment.
- **Pace on this route is Strava's number, not this app's.** The `velocity_smooth` stream is
  requested and `deriveSpeed` short-circuits on any sample that already carries a speed, so
  the same activity opened from Strava and from its own `.fit` file will not match to the
  second. Strava also resamples and applies its own elevation correction. That divergence is
  deliberate — adapters map fields, they don't reinterpret them — and it's documented in
  `src/data/strava/streamsToTrackpoints.js`.
- **Cadence is doubled for foot sports.** Strava reports one leg (~85 rpm); this app's
  `RawTrackpoint.cadenceSpm` is contractually already-doubled (~170 spm). An *unknown* foot
  sport falls back to the generic `track` sport and is therefore **not** doubled — see
  `sportFor.js`, which lists the sports it knows.
- **Manual entries and stub rows are listed but disabled**, with the reason as visible text,
  on the same principle as the intervals.icu list: an activity you know you recorded is never
  silently missing.
- **Rate limits are per-application, shared across every connected athlete** — 200 reads /
  15 min and 2,000 / day on Standard Tier. At ≤10 athletes that is comfortable. A 429 is
  never retried automatically, and Strava's window resets on the quarter hour, which the
  error copy can name because the rate-limit headers are readable same-origin.

## Project structure

```
src/
  App.jsx     # composition root: AppShell (by ActivityContext.status) + AppProviders
  app/        # composes ActivitySourceProvider + ActivityProvider + ChartViewProvider
  data/       # ActivitySource port + sourceRegistry (the one dispatch table) + adapters:
              # tcx, fit, gpx (files); intervals (browser-direct); strava (via the Worker)
  domain/     # pure, framework-free normalization pipeline (types, units, buildDistanceAxis,
              # deriveSpeed, detectPauses, smooth, samplingInterval, insertGapBreaks,
              # normalizeActivity)
  lib/        # feedbackClient — the browser side of POST /api/feedback
              # safeStorage — the guarded-storage kernel the four stores share
  stats/      # max/min/avg/median aggregation, strategy-aware, memoized hook
  metrics/    # metricRegistry — the extension point for adding metrics/sports
  state/      # ActivityContext, ChartViewContext
  ui/         # ChartStack, MetricPanel, CrosshairReadout, ChartToolbar + toggles/switch,
              # EmptyState, ErrorState, FileDropZone,
              # ActivityRowList + ActivityDateFilter — the picker chrome, provider-neutral,
              # IntervalsPage/ConnectForm + useIntervalsActivities + useDebouncedValue,
              # StravaPage/ConnectButton + useStravaActivities + useStravaOAuthCallback,
              # FeedbackWidget/Dialog/Form + useTurnstile
  styles/     # tokens.css (dark theme + metric hues), global.css (layout, chrome)
scripts/
  build-seo-pages.mjs  # runs after `vite build`: emits the static landing pages,
                       # sitemap.xml and robots.txt into dist/ (see "Static pages")
  seo/pages.mjs        # their content, as plain data — including the About prose
  seo/pages.test.mjs   # the content rules, enforced rather than reviewed
shared/       # environment-agnostic values imported by BOTH src/ and worker/ (feedbackLimits)
worker/       # the Cloudflare Worker: routes /api/feedback and /api/strava/*,
              # serves dist/ via env.ASSETS
  routes/     # feedback.js, strava.js — the request orchestration
  lib/        # validateFeedback, buildIssuePayload, verifyTurnstile, githubClient, rateLimit,
              # stravaOAuth (the client_secret half), stravaProxy (header allowlists)
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
just component props or context state — see `ChartToolbar.test.jsx` and `App.test.jsx` for
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
   browse") with the "never leaves your device" hint under it, then two quieter outlined
   buttons side by side — "Load from intervals.icu" and "Load from Strava" — under **one**
   shared disclosure paragraph. Check that paragraph reads as one honest statement covering
   both routes and not two competing claims: intervals.icu direct, Strava through the
   server, said in the same breath. The header holds the title on the left and, on the
   right, *intervals.icu*, *Strava* and an **About link** (a real `<a href="/about">`, not a
   view swap — it navigates to a static page, so `npm run dev` alone will 404 on it; use
   `wrangler dev` to click it) — no second **drop zone** anywhere while the hero is up.
3. **Load an activity** — drag a real export onto the hero (or click to browse and pick
   one), e.g. `fixtures/activity_23870166877.tcx`; dragging over it should tint the border.
   The hero should be replaced by the chart stack: a slim toolbar row at the top
   (Time/Distance switch, then one checkbox with a coloured dot per metric the file actually
   has), then the stacked line charts, each under its own head — an unfold arrow, the metric's
   hue dot, its name, and an em dash where the value will go — and the compact drop control should
   now appear in the header, so a *different* activity can be loaded without leaving this
   view. The header's left-hand cluster should now read
   `⚡ ActivityMaxxer  <name> [Running] 1 Jan 2026, 09:00 · 30:00` — the activity's identity,
   pinned there rather than in the page body. While hovering a chart it gains a trailing
   ` · 12:05 · 2.34 km`; at rest that part must be absent entirely, not a placeholder.
   Scroll down: the drop control and the two
   links fade away, that cluster stays, legible over chart ink inside one translucent chip.
   Hover the header — everything comes back, and the chip must not double-darken.
4. **Synced crosshair and fixed labels** — hover anywhere over any chart. Expect a vertical
   crosshair at the same x-position on *all* panels, and **every** panel's head to fill with
   that sample's own value in its own unit — including the panels you are not hovering.
   Nothing should follow the cursor, and no label should shift sideways as you move: they
   update in place. The elapsed time and distance appear **once**, in the header after the
   duration, regardless of x-axis mode. **The check this placement exists for:** scroll until
   the toolbar is off screen, then hover the bottom panel — the reading must still be there,
   in the faded header's chip. Move off the charts and each head goes back to
   reading `Heart rate —`, while the header reading and its `·` separator both vanish.
5. **Metric toggles** — uncheck "Cadence" in the toolbar → its panel *and its head* disappear,
   others stay aligned. Re-check it → both come back.
6. **Per-graph settings** — click the arrow beside a metric's name → its
   max/min/avg/median (plus `d/dt`, `d²/dt²` where offered) unfold **in flow**, pushing the
   charts below down rather than floating over them. Check "max" on heart rate → a dashed
   line appears in the heart-rate panel only, and its chip below it. Check `d/dt` → the
   overlay, the right-hand axis and the checked box must all be the same colour. Fold it back
   up and the charts below return to where they were.
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
    toolbar's position readout shows elapsed time in days (e.g. `2d 4:15:30`). Ctrl+scroll into one day
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
      older than ~90 days, without pressing "Load earlier"). The hit is fetched but the
      **default range hides it**, which is itself the check: widen **From** (or empty it) and
      the row appears. Then `#` plus a tag you actually use → exact tag matches. Clear the box
      → the original windowed list is back untouched and "Load earlier activities" still
      widens it correctly. Note the button is **absent** while searching, deliberately — there
      is no window under the hits.
    - In DevTools → Network while searching: **one** `search-full` request per typing burst,
      not one per keystroke. Then type fast enough to overlap two requests and confirm the
      rows on screen match the *final* query, not whichever answer arrived last. A one-letter
      query should issue nothing at all.
    - **Date range, default** — on first paint the two fields already hold the last 90 days,
      *3 months* reads as pressed, and **↺** is **absent**. In DevTools → Network the very
      first `/activities` request carries both `oldest` (90 days back) and `newest`
      (**tomorrow**, not today).
    - **Date range, the gotcha** — set **From** and **To** to the *same* day, one on which you
      recorded something: that activity must still be listed. That is the
      `newest`-excludes-its-own-day gotcha from the other side, and the single easiest thing
      here to get wrong. Confirm the native calendar refuses days outside the greyed-out bounds
      and that its panel is **dark**, and that a search run with a range active filters the
      hits and names the range in the empty message.
    - **Paging** — press *Load earlier activities*: the **From** field jumps back 90 days,
      older rows arrive, and the button is **still there**. Press it again and confirm it makes
      progress every time, including right after a response that came back empty.
    - **Reset** — **↺** appears as soon as the range differs from the default, returns both
      fields to the last 90 days, and then disappears again.
    - **Remembered per tab** — change **From**, reload: the same range comes back *and* the
      first `/activities` request uses it rather than the default. Open a **new** tab: back to
      the last 90 days, which is the whole point of `sessionStorage`. Type an end date before
      the start date: both fields go invalid, the alert shows, and **no** request fires.
    - Open a search hit → it loads and charts like any other row (same `{type:'id'}` path).
    - Reload → still connected. **Disconnect** → the key is gone from `localStorage` (check
      in DevTools → Application), the list is gone, and the app still works fully for
      dropped files.
    - Paste a deliberately wrong key → a clear "didn't accept that API key" message, and
      nothing persisted.
    - DevTools → Network: requests go to `intervals.icu` **only**, and dropping a local file
      issues **zero** network requests.
14. **Strava, with a real account** — **needs `npx wrangler dev`**, not `npm run dev`:
    `/api/strava/*` does not exist on the Vite dev server, so nothing here works without the
    Worker. It also needs the localhost Strava app's id in `.env.local` and its secret in
    `.dev.vars` (see "Connecting Strava"). This is the walkthrough that cannot be replaced by
    the automated suite, because **the two worst failures here are silent** — steps marked
    ⚠ below are those.
    - Open the *Strava* view → a branded **Connect with Strava** button, the scope
      disclosure, the connected-account cap note, and "Powered by Strava". If the client id
      is unset or still the placeholder you get a dashed developer notice instead of the
      button — that is correct, and it is what to expect on a fresh clone.
    - Press it → Strava's own consent page, showing **View data about your private
      activities**. Approve → back on `/` with **the query string stripped** (check the
      address bar: no `code`, no `state`), landed on the Strava view, listing activities.
    - **Press the browser's back button, then reload.** Neither may re-run an exchange or
      show an error — the code is single-use, and both guards exist for this.
    - Now do it again and press **Cancel** on Strava's page instead → you land on the Strava
      connect view with "access was not granted", *not* on an error state and not on a blank
      empty state. Then approve but **untick** the private-activities permission → the
      specific "connect again and leave the activity permissions ticked" message, not a
      mysteriously short list.
    - Open a Garmin-recorded run → charts render, and **⚠ check a run's cadence reads ~170
      spm, not ~85.** Strava reports one leg for foot sports and nothing throws if the
      doubling is missed. Cross-check heart rate and power against the Strava activity page.
    - **⚠ Check the row's date matches what Strava shows**, especially if you are west of
      Greenwich: `start_date_local` carries a bogus trailing `Z`, and leaving it on puts rows
      on the wrong calendar day where the 90-day filter silently drops them.
    - Note the pace **will not** exactly match the same activity's `.fit` file — Strava
      resamples and ships its own smoothed speed. That is expected and documented; a *large*
      divergence is not.
    - Back, then reopen the same activity → **no second network request** (DevTools →
      Network). Then reload the tab and reopen the Strava view within 15 minutes → the list
      paints immediately from `sessionStorage` and refreshes behind it.
    - There is **no search box**, deliberately — Strava has no search endpoint. Date filter
      and "Load earlier activities" behave exactly as they do on the intervals.icu view.
    - **Disconnect** → the list goes, `localStorage` loses the token entry and
      `sessionStorage` the cached list (DevTools → Application), **and the app disappears
      from strava.com/settings/apps**. That last one is the actual obligation; the local
      clearing is the easy half.
    - DevTools → Network throughout: every Strava request goes to **your own origin**
      (`/api/strava/*`), never to `strava.com` — and the response headers carry
      `X-ReadRateLimit-Usage`, which is how the shared daily budget is observed.
15. **Responsive layout** — narrow the window below ~720px, then all the way to 375px (iPhone
    SE) → the hero and header should both stay readable with no horizontal overflow, the
    chart toolbar should **wrap** onto two rows rather than overflow, each panel head should
    stay legible at its indent (it keeps the full ~60px so the label still sits over the line
    it names) with the unfolded stat boxes wrapping instead of spilling, and panel heights
    should drop ~25%. In the intervals.icu
    view, activity rows should be comfortable thumb targets, the date filter's presets and
    fields should **wrap** onto their own rows rather than overflow (there is no second media
    query for them), and focusing the API-key field, **the search box or either date field**
    must **not** zoom the page on an iPhone.
16. **On a real phone — the acceptance test for the mobile work, and it cannot be done in the
    simulator alone.** Run `npm run dev -- --host` and open the printed LAN URL on an iPhone.
    - **Gestures:** two-finger pinch zooms; moving both fingers together pans; a one-finger
      vertical drag still scrolls the page; and the browser never page-zooms while the
      gesture starts anywhere on the stack — including on the toolbar and the panel heads,
      which now live inside it, closing the limit this step used to record.
    - **The fixed labels on touch:** drag one finger across a chart → every panel's label
      follows, in place. Lift → they stay put, so the numbers can be read. Then tap a
      checkbox in a head → the readout must **not** blank; only touching another chart hands
      the crosshair over.
    - **Screenshots, the whole point of the frame work:** scroll down mid-activity and take
      one. It must show, in one translucent chip in the upper left, the bolt +
      "ActivityMaxxer" on the first row and the activity name, sport chip, start date/time
      and duration wrapped onto a second — and, with a finger down on a chart, the crosshair's
      `12:05 · 2.34 km` joining them inside that same chip — the wordmark **not** dropped, the
      name **not** truncated, all of it legible against chart ink — then charts filling the rest, no
      half-collapsed chrome, no horizontal overflow, and a **dark** Safari address bar.
      Repeat at the top of the page and while zoomed in (where the duration should read the
      window's span, not the activity's) — **all three should be sharable as-is**.
17. **Feedback dialog** — needs `wrangler dev`, not `npm run dev`, since the API route only
    exists in the Worker. Click **Feedback** in the footer → a modal opens with subject /
    message / optional email, a "this opens a public issue on GitHub" notice, a Turnstile
    widget, and a **Send feedback** button that stays disabled until the challenge is
    solved. Submit → expect "filed as issue #N" with a working link, and a real issue in
    `Mcklmo/timeseries-visualizer` labelled `feedback`, whose body carries the message plus
    page URL / timestamp / user agent. Then check the failure paths: submit with the fields
    empty (expect inline per-field errors, not a banner), and submit ~6 times in a minute
    (expect the "too many submissions" banner).
18. **Escape closes the dialog** — press `Esc` with the feedback dialog open. This is native
    `<dialog>` behaviour that jsdom does not simulate, so it is *only* covered here, never
    by the automated suite. Re-opening afterwards should show empty fields, not the previous
    attempt.
19. **Static pages** — needs `wrangler dev`, since these are files in `dist/` rather than
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
Worker serves `dist/`, the `/api/feedback` route the feedback form posts to, and the
`/api/strava/*` routes the Strava picker reads through. The old Pages dashboard "Connect to
Git" flow is gone on purpose — it has no concept of `wrangler.jsonc`'s
`main`/`assets.binding`/`ratelimits`, so it cannot serve those routes at all.

One-time setup, by whoever owns the Cloudflare account:

```bash
npx wrangler secret put GITHUB_TOKEN           # fine-grained PAT, this repo only, "Issues: write"
npx wrangler secret put TURNSTILE_SECRET_KEY   # secret half of the Turnstile widget
npx wrangler secret put STRAVA_CLIENT_SECRET   # the production Strava app's; its *id* is
                                               # public and lives in wrangler.jsonc + .env
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
