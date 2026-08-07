# Activity Visualiser

A web UI, in the spirit of Intervals.ICU / Garmin Connect, for inspecting a single running
or cycling activity as vertically stacked, time-synced charts (pace/speed, heart rate,
cadence, power, elevation) sharing one x-axis — elapsed time or distance.

v1 scope is intentionally narrow: running and cycling only, metric units only, single
activity, no persistence, no auth. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full
design spec, build order, and rationale — this README is the practical "how do I run/build
this" doc.

## Status

This project is **functional end-to-end, including real Garmin TCX file upload** — drop a
`.tcx` export and it's parsed and charted for real, not just resolved to the bundled mock.
What exists today:

- Domain pipeline (`src/domain/`), stats/aggregation (`src/stats/`), the metric registry
  (`src/metrics/`), and the `ActivitySource` port + `MockActivitySource` + JSON fixture
  are built and tested.
- State layer (`ActivityContext`, `ChartViewContext`, `AppProviders`) is built and tested.
- `ChartStack` / `MetricPanel` / `SyncedTooltip` render synced, aligned charts against the
  mock activity, verified against real rendered Recharts SVG output.
- `ControlPanel` and its children (`MetricToggle`, `StatCheckboxes`, `XAxisModeSwitch`) drive
  metric visibility, per-metric stat lines, and x-axis mode — also verified against real
  rendered Recharts SVG output, not just context state.
- The bottom panel of `ChartStack` renders a `Brush` wired to a shared, controlled
  `zoomDomain` — dragging it zooms/pans every panel in sync, and switching x-axis mode resets
  the zoom (a numeric range in seconds is meaningless once re-read as metres). Verified by
  simulating a real Recharts drag against rendered SVG output, not just calling the state
  setter directly.
- `App.jsx` is wired end-to-end: drop a file or click "Load sample activity" on the
  `EmptyState`, watch `ActivityContext` cycle through `loading`, and land on `ControlPanel` +
  `ChartStack` (or `ErrorState`, with a "Try again" that replays the same load).
- The dark, chart-forward visual theme from ARCHITECTURE.md §9 is applied
  (`styles/tokens.css` + `styles/global.css`); the old default-Vite-template files
  (`App.css`, `index.css`, starter assets) are gone.
- The domain pipeline (`buildDistanceAxis`, `deriveSpeed`, `detectPauses`, `smooth`,
  `normalizeActivity`) and `data/tcx/` (`parseTcx` + `TcxActivitySource`) are built and
  tested, including a cross-check against a real Garmin export (see Testing notes below):
  computed average pace matches Garmin's own reported value to the second. `App.jsx`
  routes a dropped/browsed file to the real TCX parser and the "Load sample activity"
  button to the mock fixture — see ARCHITECTURE.md §0 for why both adapters coexist.
- The footer's **Feedback** link opens a dialog that files a labelled GitHub issue on this
  repo via `POST /api/feedback`, guarded by Cloudflare Turnstile plus a native rate-limit
  binding. This is the project's only server-side code (`worker/`) — activity files are
  still parsed entirely in the browser and never uploaded anywhere. See "Feedback form
  configuration" under Deploying.
- The HTTP source stub and `downsample.js` are still unbuilt — not needed until there's a
  real API to swap in, or an activity long enough to need downsampling.

Check the checklist at the top of [ARCHITECTURE.md](ARCHITECTURE.md#0-implementation-progress)
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

## Project structure

```
src/
  App.jsx     # composition root: AppShell (by ActivityContext.status) + AppProviders
  app/        # composes ActivitySourceProvider + ActivityProvider + ChartViewProvider
  data/       # ActivitySource port + adapters (mock + tcx + fit built; http is a stub)
  domain/     # pure, framework-free normalization pipeline (types, units, buildDistanceAxis,
              # deriveSpeed, detectPauses, smooth, normalizeActivity)
  lib/        # feedbackClient — the browser side of POST /api/feedback
  stats/      # max/min/avg/median aggregation, strategy-aware, memoized hook
  metrics/    # metricRegistry — the extension point for adding metrics/sports
  state/      # ActivityContext, ChartViewContext
  ui/         # ChartStack, MetricPanel, SyncedTooltip, ControlPanel + toggles/switch,
              # LoadActivityBar, ErrorState, FileDropZone, AboutPage,
              # FeedbackWidget/Dialog/Form + useTurnstile
  styles/     # tokens.css (dark theme + metric hues), global.css (layout, chrome)
shared/       # environment-agnostic values imported by BOTH src/ and worker/ (feedbackLimits)
worker/       # the Cloudflare Worker: routes /api/feedback, serves dist/ via env.ASSETS
  routes/     # feedback.js — the request orchestration
  lib/        # validateFeedback, buildIssuePayload, verifyTurnstile, githubClient, rateLimit
fixtures/
  sample-run.json                        # activity used by MockActivitySource in dev/tests
  activity_23870166877.tcx               # real Garmin export, used by the parser cross-check test
  activity_23870166877-meta.json         # Garmin's own reported stats for that export
```

The dependency rule: `domain/` imports nothing from `ui/`, `data/`, or React; `data/`
imports `domain/` types only. This is what lets a future HTTP `ActivitySource` replace TCX
file upload without touching any component. `shared/` extends it across the client/server
line: plain values only, importable by both `src/` and `worker/`, which never import each
other. See ARCHITECTURE.md §3–§6 for the full layer diagram and the metric registry
contract.

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

### Manual testing walkthrough

The automated suite already asserts against real rendered Recharts SVG output, but it's
still worth eyeballing the app after UI changes — some regressions (alignment, contrast,
responsive collapse) only show up visually. There's no manual step for the loading state
with the real sources (both resolve too fast to reliably observe by hand) or the error
state from a *rejected* load — those are only exercised by `App.test.jsx` against a
controlled source double. Dropping a malformed file is a real, manually-triggerable error
path, though (see step 9 below).

1. **Start the dev server** — `npm run dev`, then open the printed URL.
2. **Empty state** — page loads to a dark-themed "Load a run" panel with a dashed drop zone
   ("Drop a TCX file here, or click to browse") and a "Load sample activity" button below it.
3. **Load the sample activity** — click **Load sample activity**. The empty-state panel
   should be replaced by a control panel (Time/Distance switch + one row per metric — Pace,
   Heart rate, Cadence, Elevation — each with a colored dot, a checkbox, and max/avg/median
   checkboxes) and 4 stacked line charts below it.
4. **Synced crosshair/tooltip** — hover anywhere over any chart. Expect a vertical crosshair
   and tooltip at the same x-position on *all* panels, with the tooltip header always showing
   both elapsed time and distance regardless of mode.
5. **Metric toggles** — uncheck "Cadence" → its panel disappears, others stay aligned.
   Re-check it → it comes back.
6. **Stat reference lines** — check "Heart rate max" → a dashed line + label appears in the
   heart-rate panel only. Uncheck "avg" on any metric → its solid reference line disappears.
7. **X-axis mode** — click **Distance** → the bottom axis ticks switch from seconds to
   metres on every panel. Click **Time** to switch back.
8. **Brush / zoom** — drag the brush handles under the bottom chart → all panels zoom to the
   same range together. While zoomed, switch Time ⇄ Distance → zoom should reset to full
   range (not carry over a stale numeric range).
9. **File drop** — drag a real `.tcx` export (or click to browse and pick one) onto the drop
   zone, e.g. `fixtures/activity_23870166877.tcx`. It's parsed for real: expect the panel set
   to reflect *that file's* available metrics (no Power panel for a file with no power meter,
   for instance), not the mock's fixed four. Drop a non-TCX file (or a `.tcx` with invalid
   XML) to see the error state instead — `ErrorState` shows the parser's specific message.
10. **Responsive layout** — narrow the window below ~720px → each metric's toggle +
    stat-checkboxes row should stack instead of staying side-by-side.
11. **Feedback dialog** — needs `wrangler dev`, not `npm run dev`, since the API route only
    exists in the Worker. Click **Feedback** in the footer → a modal opens with subject /
    message / optional email, a "this opens a public issue on GitHub" notice, a Turnstile
    widget, and a **Send feedback** button that stays disabled until the challenge is
    solved. Submit → expect "filed as issue #N" with a working link, and a real issue in
    `Mcklmo/timeseries-visualizer` labelled `feedback`, whose body carries the message plus
    page URL / timestamp / user agent. Then check the failure paths: submit with the fields
    empty (expect inline per-field errors, not a banner), and submit ~6 times in a minute
    (expect the "too many submissions" banner).
12. **Escape closes the dialog** — press `Esc` with the feedback dialog open. This is native
    `<dialog>` behaviour that jsdom does not simulate, so it is *only* covered here, never
    by the automated suite. Re-opening afterwards should show empty fields, not the previous
    attempt.

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

Cloudflare gives you a `*.workers.dev` URL; a custom domain attaches under the Worker's
own **Settings → Domains & Routes** in the dashboard. Auto-deploy-on-push is deliberately
out of scope — this is the manual flow.

No `base` path needs setting in `vite.config.ts` — the Worker serves from the domain root
(unlike GitHub Pages, which would need a repo-subpath `base` if used instead).

### Feedback form configuration

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
[ARCHITECTURE.md](ARCHITECTURE.md) first — §11 gives the build order, §0 tracks what's
done, and §12 lists seams that are deliberately designed for but not yet built
(multi-activity overlay, laps).
