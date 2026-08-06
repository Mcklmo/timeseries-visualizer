# Activity Visualiser

A web UI, in the spirit of Intervals.ICU / Garmin Connect, for inspecting a single running
activity as vertically stacked, time-synced charts (pace, heart rate, cadence, power,
elevation) sharing one x-axis — elapsed time or distance.

v1 scope is intentionally narrow: running only, metric units only, single activity, no
persistence, no auth. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design spec,
build order, and rationale — this README is the practical "how do I run/build this" doc.

## Status

This project is **under active development, not yet functional end-to-end**. What exists
today:

- Domain pipeline (`src/domain/`), stats/aggregation (`src/stats/`), the metric registry
  (`src/metrics/`), and the `ActivitySource` port + `MockActivitySource` + JSON fixture
  are built and tested.
- State layer (`ActivityContext`, `ChartViewContext`, `AppProviders`) is built and tested.
- `ChartStack` / `MetricPanel` / `SyncedTooltip` render synced, aligned charts against the
  mock activity, verified against real rendered Recharts SVG output.
- `ControlPanel` and its children (`MetricToggle`, `StatCheckboxes`, `XAxisModeSwitch`) drive
  metric visibility, per-metric stat lines, and x-axis mode — also verified against real
  rendered Recharts SVG output, not just context state.
- `App.jsx` is still the default Vite starter page — it is **not yet wired** to the chart
  stack or control panel. `FileDropZone`, `EmptyState`, `ErrorState`, TCX parsing
  (`data/tcx/`), the HTTP source stub, `Brush`/zoom, and `downsample.js` are all placeholder
  files (`// TODO: see ARCHITECTURE.md`) or unbuilt — not implemented yet.

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

## Project structure

```
src/
  app/        # composes ActivitySourceProvider + ActivityProvider + ChartViewProvider
  data/       # ActivitySource port + adapters (mock built; tcx/http are stubs)
  domain/     # pure, framework-free normalization pipeline (types, units, ...)
  stats/      # max/avg/median aggregation, strategy-aware, memoized hook
  metrics/    # metricRegistry — the extension point for adding metrics/sports
  state/      # ActivityContext, ChartViewContext
  ui/         # ChartStack, MetricPanel, SyncedTooltip, ControlPanel + toggles/switch
fixtures/
  sample-run.json   # activity used by MockActivitySource in dev/tests
```

The dependency rule: `domain/` imports nothing from `ui/`, `data/`, or React; `data/`
imports `domain/` types only. This is what lets a future HTTP `ActivitySource` replace TCX
file upload without touching any component. See ARCHITECTURE.md §3–§6 for the full layer
diagram and the metric registry contract.

## Testing notes

- `src/setupTests.js` stubs `ResizeObserver` and provides a fixed `getBoundingClientRect`
  (jsdom reports 0×0 otherwise, which collapses Recharts' `ResponsiveContainer`), and calls
  `afterEach(cleanup)` explicitly since this project doesn't enable Vitest's `globals`.
- Chart tests assert against actual rendered SVG (parsed path/line coordinates), not just
  component props — see ARCHITECTURE.md §0 for the jsdom pitfalls that motivated this.

## Contributing / continuing the build

If you're picking this up (human or agent), read
[ARCHITECTURE.md](ARCHITECTURE.md) first — §11 gives the build order, §0 tracks what's
done, and §12 lists seams that are deliberately designed for but not yet built (cycling
support, multi-activity overlay, laps).
