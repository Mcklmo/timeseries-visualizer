import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { ActivityHeader } from './ActivityHeader.jsx'
import { ChartStack } from './ChartStack.jsx'
import { AppProviders } from '../app/providers.jsx'
import { buildTrack } from '../domain/buildTrack.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { metricRegistry, metricOrder, statKindsFor } from '../metrics/metricRegistry.js'
import { resetCrosshairBus } from './crosshairBus.js'
import { statCheckboxLabel } from './StatCheckboxes.jsx'

const fixtureActivity = {
  id: 'a1',
  sport: 'running',
  totalMovingTime: 40,
  totalDistance: 200,
  samples: [
    { t: 0, d: 0, speed: 4, heartRate: 120, cadence: 170, altitude: 10, moving: true },
    { t: 10, d: 50, speed: 5, heartRate: 130, cadence: 172, altitude: 12, moving: true },
    { t: 20, d: 100, speed: 6, heartRate: 150, cadence: 174, altitude: 14, moving: true },
    { t: 30, d: 150, speed: 5, heartRate: 140, cadence: 176, altitude: 16, moving: true },
    { t: 40, d: 200, speed: 3, heartRate: 110, cadence: 178, altitude: 18, moving: true },
  ],
  availableMetrics: ['pace', 'heartRate', 'cadence', 'altitude'],
  // No route by default, so the ~40 tests above this line see exactly the stack
  // they always did. The map is opt-in per fixture, not per test file.
  track: null,
}

// The same activity with a route on it. Five fixes running due east, one per
// sample, so `track.x[i]` and `samples[i]` line up the way normalizeActivity
// guarantees they do in the app.
const routedActivity = {
  ...fixtureActivity,
  track: buildTrack(
    [12, 12.01, 12.02, 12.03, 12.04].map((lon) => ({ time: new Date(0), lat: 55, lon })),
  ),
}

function makeSource(activity) {
  return { kind: 'mock', load: () => Promise.resolve(activity) }
}

function Loader() {
  const { load } = useActivity()
  useEffect(() => {
    load({ type: 'id', id: 'x' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function ToggleMetric({ metricId }) {
  const { toggleMetric } = useChartView()
  return <button onClick={() => toggleMetric(metricId)}>toggle-{metricId}</button>
}

// Every stat is off until asked for, so any test that wants a reference line
// or a stat chip has to switch one on first.
function ToggleStat({ metricId, statKind }) {
  const { toggleStat } = useChartView()
  return (
    <button onClick={() => toggleStat(metricId, statKind)}>
      toggle-{metricId}-{statKind}
    </button>
  )
}

function SwitchXMode({ mode }) {
  const { setXMode } = useChartView()
  return <button onClick={() => setXMode(mode)}>switch-x-{mode}</button>
}

// Drags one edge of the zoom window — THE only way to zoom, since the pinch and
// ctrl/⌘+wheel gestures were deleted (ui/useWheelPan.js's header says why).
// setupTests.js hard-assigns one fixed {left:0, width:800} rect to EVERY
// element, so the plot area is {left: 60, width: 728} — and 728 = 8 × 91, so
// eighth-fractions land on integer clientX: 0.25→242, 0.5→424, 0.75→606, and
// the plot's own edges on 60 and 788.
//
// `from` should be where the handle actually is, since pointerdown emits a
// frame of its own; the drag is then direct, so `to` names the value the edge
// lands on through the CURRENTLY PLOTTED view. `release` commits it, which is
// what re-fits the view symmetrically — leave it off to inspect a live gesture.
async function dragWindowEdge(container, { edge, from, to, release = true }) {
  const panel = container.querySelector('.metric-panel')
  const handle = [...panel.querySelectorAll('.zoom-handle')][edge === 'start' ? 0 : 1]
  const at = (clientX) => ({ clientX, pointerId: 1 })
  fireEvent.pointerDown(handle, at(from))
  // Emission is rAF-coalesced, so nothing has been written to zoomDomain until
  // a frame passes.
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  fireEvent.pointerMove(window, at(to))
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  if (!release) return
  fireEvent.pointerUp(window, at(to))
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

// The reference window for every test that reads the window's CONTENTS: both
// edges pulled in until the window holds exactly the 10/20/30 s samples and
// excludes the 0 s and 40 s ones. The start edge lands on 10 s exactly (a
// quarter across the unzoomed 0–40 s view) and the end edge inside (30, 40),
// which is all the stats and the header duration depend on.
async function trimToMidWindow(container) {
  await dragWindowEdge(container, { edge: 'start', from: 60, to: 242 })
  // The view has re-fitted to [2.5, 40] around the new window, so the end
  // handle is still parked on the plot's right edge — and 606 now reads 30.6 s.
  await dragWindowEdge(container, { edge: 'end', from: 788, to: 606 })
}

// The x coordinates of the rendered curve, read back out of the path `d`.
//
// This replaces the old point-COUNT technique, which rested on a mechanism
// that never existed: Recharts' computeLinePoints maps every row through the
// scale and filters only nullish *values*, and a d3 linear scale extrapolates
// — so out-of-domain points keep coordinates and stay in the path. Points used
// to disappear because the Brush sliced the data array, not because of the
// domain. Comparing positions is also strictly stronger than comparing counts:
// it pins where the samples actually landed, in pixels.
function pathXs(panel) {
  const d = panel.querySelector('.metric-line .recharts-curve').getAttribute('d')
  return [...d.matchAll(/[ML](-?[\d.]+),/g)].map(([, x]) => Number(x))
}

function xSpread(panel) {
  const xs = pathXs(panel)
  return Math.max(...xs) - Math.min(...xs)
}

function tickLabels(panel) {
  return [...panel.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan')].map(
    (el) => el.textContent,
  )
}

// Elapsed ticks are formatted by span now (units.js); this fixture's 40-second
// span puts them in the m:ss band, so read them back to seconds rather than
// asserting on the copy — the assertion below is about the zoom domain.
function tickSeconds(label) {
  const [minutes, seconds] = label.split(':').map(Number)
  return minutes * 60 + seconds
}

// Recharts' mouse middleware is rAF-throttled, so a hover is not observable
// until a couple of frames have passed.
async function settleHover() {
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

// Where the crosshair is drawn on each panel, in SVG x — which is client x too,
// since ResponsiveContainer sizes the <svg> in CSS pixels with no transform.
// Panels differ in height, so the cursor's y-extent legitimately differs; only
// x means anything across panels.
function cursorXs(container) {
  return [...container.querySelectorAll('.recharts-wrapper')].map(
    (w) => w.querySelector('.recharts-tooltip-cursor')?.getAttribute('d').match(/M(-?[\d.]+),/)[1],
  )
}

// One finger, in the plain-object form jsdom's missing Touch constructor forces
// (see the note at the top of useTouchScrub.test.jsx). clientY 100 is the
// vertical middle of every element under setupTests.js's fixed rect.
const touchAt = (clientX, clientY = 100) => ({ touches: [{ clientX, clientY }] })
// Two fingers is the browser's page zoom now. The app's only job is to keep out
// of its way, which is what the handoff test below asserts.
const twoFingerTouch = { touches: [{ clientX: 242, clientY: 100 }, { clientX: 606, clientY: 100 }] }
const lifted = { touches: [] }

// Puts the crosshair somewhere with the mouse, so a touch scrub has something
// to move *relative to*. clientX 300 settles on the sample at t=10s, i.e. 242.
async function anchorCrosshair(container, clientX = 300) {
  const wrapper = container.querySelector('.recharts-wrapper')
  fireEvent.mouseOver(wrapper)
  fireEvent.mouseMove(wrapper, { clientX, clientY: 50 })
  await settleHover()
}

// A panel found by the colour of the line it draws, since the panels carry no
// metric id in the DOM and their order shifts as metrics are toggled.
function panelFor(container, metricId) {
  return [...container.querySelectorAll('.metric-panel')].find(
    (p) => p.querySelector('.metric-line .recharts-curve')?.getAttribute('stroke') === metricRegistry[metricId].color,
  )
}

// Mirrors AppShell: it owns the one position-slot node, hands the ref to the
// header and the node to the stack. In the app those two ends live in
// different subtrees, so a test that renders the stack alone cannot fill the
// shared readout at all.
function StackWithHeader({ extra }) {
  const [positionSlot, setPositionSlot] = useState(null)
  return (
    <>
      <ActivityHeader positionRef={setPositionSlot} />
      {extra}
      <ChartStack positionSlot={positionSlot} />
    </>
  )
}

async function renderStack({ activity = fixtureActivity, extra = null } = {}) {
  const utils = render(
    <AppProviders source={makeSource(activity)}>
      <Loader />
      <StackWithHeader extra={extra} />
    </AppProviders>,
  )
  // Wait past the point where `.metric-panel` wrapper divs exist: Recharts'
  // ResponsiveContainer measures itself in a `useEffect` that commits after
  // that initial render, so asserting too early catches panels mid-layout
  // (still 0x0, no line/axis children yet) and flakes intermittently.
  await waitFor(() => {
    const panelCount = utils.container.querySelectorAll('.metric-panel').length
    expect(panelCount).toBeGreaterThan(0)
    expect(utils.container.querySelectorAll('.recharts-line .recharts-curve')).toHaveLength(panelCount)
  })
  return utils
}

describe('ChartStack', () => {
  it('renders nothing before the activity has loaded', () => {
    const { container } = render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <ChartStack />
      </AppProviders>,
    )
    expect(container.querySelectorAll('.metric-panel')).toHaveLength(0)
  })

  it('renders one panel per available metric, in canonical metricOrder', async () => {
    const { container } = await renderStack()
    const panels = container.querySelectorAll('.metric-panel')
    expect(panels).toHaveLength(4)

    const expectedOrder = metricOrder.filter((id) => fixtureActivity.availableMetrics.includes(id))
    const colors = [...panels].map((p) => p.querySelector('.metric-line .recharts-curve').getAttribute('stroke'))
    expect(colors).toEqual(expectedOrder.map((id) => metricRegistry[id].color))
  })

  it('only renders panels for metrics the activity actually has data for', async () => {
    const sparse = { ...fixtureActivity, availableMetrics: ['heartRate', 'altitude'] }
    const { container } = await renderStack({ activity: sparse })
    const panels = container.querySelectorAll('.metric-panel')
    expect(panels).toHaveLength(2)
    const colors = [...panels].map((p) => p.querySelector('.metric-line .recharts-curve').getAttribute('stroke'))
    expect(colors).toEqual([metricRegistry.heartRate.color, metricRegistry.altitude.color])
  })

  it('renders a Speed panel instead of Pace for a cycling activity, even though both are "available"', async () => {
    // normalizeActivity flags both pace and speed as available whenever
    // speed data exists (it's sport-agnostic by design) — the sport-based
    // pick between them happens here, via isMetricForSport. pace and speed
    // share a line color (they never render together), so disambiguate via a
    // stat chip's unit text — switching avg on for *both*, since which of the
    // two rendered is the very thing under test.
    const cycling = { ...fixtureActivity, sport: 'cycling', availableMetrics: ['pace', 'speed', 'heartRate'] }
    const { container } = await renderStack({
      activity: cycling,
      extra: (
        <>
          <ToggleStat metricId="pace" statKind="avg" />
          <ToggleStat metricId="speed" statKind="avg" />
        </>
      ),
    })
    fireEvent.click(screen.getByText('toggle-pace-avg'))
    fireEvent.click(screen.getByText('toggle-speed-avg'))

    const panels = container.querySelectorAll('.metric-panel')
    expect(panels).toHaveLength(2) // only one "how fast" panel, not both pace and speed
    await waitFor(() => expect(panels[0].textContent).toContain('km/h'))
    expect(panels[0].textContent).not.toContain('min/km')
  })

  it('gives the first panel more height than the rest, and every other panel the same', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    // minHeight (not height) so the panel can grow past the chart's own
    // height to fit the stat-chip row below it, instead of clipping it.
    const heights = panels.map((p) => p.style.minHeight)
    expect(heights).toEqual(['200px', '140px', '140px', '140px'])
  })

  it('shows x-axis tick labels only on the bottom panel', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    const tickLabelCounts = panels.map((p) => p.querySelectorAll('.recharts-xAxis-tick-labels').length)
    expect(tickLabelCounts.slice(0, -1)).toEqual([0, 0, 0])
    expect(tickLabelCounts.at(-1)).toBeGreaterThan(0)
  })

  it('aligns every panel on the same left edge (fixed y-axis width)', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    const leftEdges = panels.map((p) => p.querySelector('.recharts-yAxis .recharts-cartesian-axis-line').getAttribute('x1'))
    expect(new Set(leftEdges).size).toBe(1)
  })

  // THE derivative-overlay invariant (ARCHITECTURE.md §7). The right-hand axis
  // narrows the plot, and the gestures measure ONE .recharts-surface — the first
  // in the stack — then apply that rect to gestures anywhere on it. So the
  // gutter has to be reserved on every visible panel the moment any one of them
  // has an overlay. Reserve it per panel instead and the failures are silent:
  // lines horizontally offset between panels, and a dragged edge that lands
  // 44px out from under the pointer.
  it('reserves the derivative gutter on every panel, so plot areas stay aligned', async () => {
    const { container } = await renderStack({
      extra: <ToggleStat metricId="heartRate" statKind="d1" />,
    })
    const panels = () => [...container.querySelectorAll('.metric-panel')]

    // One y-axis each, and identical x positions, before any overlay exists.
    expect(panels().map((p) => p.querySelectorAll('.recharts-yAxis').length)).toEqual([1, 1, 1, 1])
    const before = panels().map(pathXs)
    expect(new Set(before.map((xs) => JSON.stringify(xs))).size).toBe(1)

    fireEvent.click(screen.getByText('toggle-heartRate-d1'))

    // Heart rate is the only metric with an overlay, but ALL FOUR panels now
    // carry the second axis — that is the whole invariant.
    await waitFor(() =>
      expect(panels().map((p) => p.querySelectorAll('.recharts-yAxis').length)).toEqual([2, 2, 2, 2]),
    )
    const after = panels().map(pathXs)
    expect(new Set(after.map((xs) => JSON.stringify(xs))).size).toBe(1)

    // And the plot really did get narrower — otherwise "all four agree" would
    // pass trivially with an axis that reserved no width at all.
    expect(xSpread(panels()[0])).toBeLessThan(before[0].at(-1) - before[0][0])
  })

  it('draws the overlay on the panel that asked for it, and only there', async () => {
    const { container } = await renderStack({
      extra: <ToggleStat metricId="heartRate" statKind="d1" />,
    })
    const overlayCounts = () =>
      [...container.querySelectorAll('.metric-panel')].map((p) => p.querySelectorAll('.deriv-line').length)

    expect(overlayCounts()).toEqual([0, 0, 0, 0])

    fireEvent.click(screen.getByText('toggle-heartRate-d1'))

    // panels are pace, heartRate, cadence, altitude — only heartRate gains the
    // overlay, even though every panel gained the axis.
    await waitFor(() => expect(overlayCounts()).toEqual([0, 1, 0, 0]))
  })

  it('gives the gutter back when the last overlay is switched off', async () => {
    const { container } = await renderStack({
      extra: <ToggleStat metricId="heartRate" statKind="d1" />,
    })
    const before = pathXs([...container.querySelectorAll('.metric-panel')][0])

    fireEvent.click(screen.getByText('toggle-heartRate-d1'))
    await waitFor(() =>
      expect(container.querySelectorAll('.metric-panel')[0].querySelectorAll('.recharts-yAxis')).toHaveLength(2),
    )

    fireEvent.click(screen.getByText('toggle-heartRate-d1'))
    // Byte-identical to the pre-overlay layout, not merely close: the gesture's
    // rightInset defaults back to 0 and the two have to agree exactly.
    await waitFor(() => expect(pathXs([...container.querySelectorAll('.metric-panel')][0])).toEqual(before))
  })

  it('syncs the crosshair across all panels when hovering one', async () => {
    const { container } = await renderStack()
    const wrappers = [...container.querySelectorAll('.recharts-wrapper')]
    expect(wrappers).toHaveLength(4)

    fireEvent.mouseOver(wrappers[0])
    fireEvent.mouseMove(wrappers[0], { clientX: 300, clientY: 50 })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const cursors = wrappers.map((w) => w.querySelector('.recharts-tooltip-cursor'))
    expect(cursors.every(Boolean)).toBe(true)
    // Panels differ in height, so the cursor's y-extent legitimately differs —
    // only its x position (where in time/distance the pointer landed) must
    // match across all four for the crosshair to read as "synced".
    const xPositions = cursors.map((c) => c.getAttribute('d').match(/M(-?[\d.]+),/)[1])
    expect(new Set(xPositions).size).toBe(1)
  })

  // The readout is fixed at each panel's upper left now, fed by that panel's own
  // <Tooltip content> portaling into its head (ui/CrosshairReadout.jsx). The
  // panel under the pointer would fill its own label from its own hover no
  // matter how this were wired — the three panels NOBODY is hovering are the
  // assertion: they can only fill theirs by receiving the syncId event and
  // rendering their content while inactive-but-synced.
  it('fills every panel’s fixed label from a hover on any one of them', async () => {
    const { container } = await renderStack()
    const wrappers = [...container.querySelectorAll('.recharts-wrapper')]
    const slots = () => [...container.querySelectorAll('.crosshair-slot')]

    // At rest every slot is empty — the em dash is a CSS :empty rule, not text.
    expect(slots()).toHaveLength(4)
    expect(slots().every((slot) => slot.textContent === '')).toBe(true)

    fireEvent.mouseOver(wrappers[0])
    fireEvent.mouseMove(wrappers[0], { clientX: 300, clientY: 50 })
    await settleHover()

    // clientX 300 lands on the sample at t=10s (plot {left: 60, width: 728},
    // so the samples sit at 60/242/424/606/788 and 300 is nearest 242).
    await waitFor(() => expect(slots().every((slot) => slot.textContent !== '')).toBe(true))
    const panels = [...container.querySelectorAll('.metric-panel')]
    // Panels are pace, heartRate, cadence, altitude. Each reports its OWN
    // metric at the shared sample, in its own unit.
    expect(panels[1].querySelector('.crosshair-slot').textContent).toContain('130 bpm')
    expect(panels[2].querySelector('.crosshair-slot').textContent).toContain('172 spm')
  })

  it('reports the hovered position once, in the header, rather than once per panel', async () => {
    const { container } = await renderStack()
    // No .app-header wrapper in this harness, so the identity cluster itself is
    // the structural anchor.
    const position = () => container.querySelector('.activity-header .crosshair-position')
    expect(container.querySelectorAll('.crosshair-position')).toHaveLength(1)
    // The regression guard for the whole move: it is not in the scrolling row.
    expect(container.querySelector('.chart-toolbar .crosshair-position')).toBeNull()
    expect(position().textContent).toBe('')

    fireEvent.mouseOver(container.querySelectorAll('.recharts-wrapper')[2])
    fireEvent.mouseMove(container.querySelectorAll('.recharts-wrapper')[2], { clientX: 300, clientY: 50 })
    await settleHover()

    // Time AND distance, whichever the x-axis is showing. Driven by the first
    // panel even though the third one was hovered — every panel is synced to
    // the same sample, so one of them speaks for the stack.
    await waitFor(() => expect(position().textContent).toContain('0:10'))
    expect(position().textContent).toContain('0.05 km')
  })

  it('re-homes the shared position readout when the first metric is switched off', async () => {
    // The first visible panel drives it, so "first" has to be resolved per
    // render rather than pinned to a metric id.
    const { container } = await renderStack({ extra: <ToggleMetric metricId="pace" /> })
    fireEvent.click(screen.getByText('toggle-pace'))
    await waitFor(() => expect(container.querySelectorAll('.metric-panel')).toHaveLength(3))

    const wrapper = container.querySelector('.recharts-wrapper')
    fireEvent.mouseOver(wrapper)
    fireEvent.mouseMove(wrapper, { clientX: 300, clientY: 50 })
    await settleHover()

    await waitFor(() =>
      expect(container.querySelector('.crosshair-position').textContent).toContain('0:10'),
    )
  })

  // ── per-graph settings ──────────────────────────────────────────────────
  //
  // Ported from ControlPanel.test.jsx, where the same clicks went through one
  // settings window. The boxes are in each panel's head now, so what these
  // check is the wiring ChartStack owns: `toggleStat` handed down as a prop,
  // and the reference line landing on the graph whose head was clicked.
  it('starts every stat unchecked, drawing no reference lines until one is asked for', async () => {
    const { container } = await renderStack()
    for (const id of metricOrder.filter((m) => fixtureActivity.availableMetrics.includes(m))) {
      for (const kind of statKindsFor(metricRegistry[id])) {
        expect(screen.getByRole('checkbox', { name: statCheckboxLabel(metricRegistry[id], kind) })).not.toBeChecked()
      }
      expect(panelFor(container, id).querySelectorAll('.recharts-reference-line')).toHaveLength(0)
    }
  })

  it('draws a reference line on the graph whose own head asked for it, and only there', async () => {
    const { container } = await renderStack()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Heart rate max' }))

    await waitFor(() =>
      expect(panelFor(container, 'heartRate').querySelectorAll('.recharts-reference-line')).toHaveLength(1),
    )
    expect(panelFor(container, 'cadence').querySelectorAll('.recharts-reference-line')).toHaveLength(0)

    // Unchecking takes it away again, and a second kind adds a second line.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Heart rate avg' }))
    await waitFor(() =>
      expect(panelFor(container, 'heartRate').querySelectorAll('.recharts-reference-line')).toHaveLength(2),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Heart rate max' }))
    await waitFor(() =>
      expect(panelFor(container, 'heartRate').querySelectorAll('.recharts-reference-line')).toHaveLength(1),
    )
  })

  it('keeps the one-derivative-per-metric rule when the click comes from a panel head', async () => {
    // The exclusion lives in ChartViewContext's toggleStat, and the head must
    // keep going through it rather than writing enabledStats another way — one
    // right-hand axis carries one unit.
    const { container } = await renderStack()
    const ramp = screen.getByRole('checkbox', { name: 'Heart rate ramp' })
    const rampAccel = screen.getByRole('checkbox', { name: 'Heart rate ramp accel' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Heart rate max' }))
    fireEvent.click(ramp)
    await waitFor(() => expect(panelFor(container, 'heartRate').querySelector('.deriv-line')).not.toBeNull())

    fireEvent.click(rampAccel)
    await waitFor(() => expect(rampAccel).toBeChecked())
    expect(ramp).not.toBeChecked()
    // The scalar stat is untouched by the exclusion: it is on its own axis.
    expect(screen.getByRole('checkbox', { name: 'Heart rate max' })).toBeChecked()
  })

  // The mobile freeze (useTouchHoverHandoff): a panel that has been touched
  // holds its OWN Recharts hover, which outranks the incoming syncId event, so
  // without the handoff it stays pinned at its last index while every other
  // panel follows the new finger. mouseOver+mouseMove is the same
  // `setMouseOverAxisIndex` state a touchmove produces, so it reproduces the
  // stale hover without needing touch events jsdom can't build.
  it('releases a previously-touched panel back to the synced crosshair when another panel is touched', async () => {
    const { container } = await renderStack()
    const wrappers = [...container.querySelectorAll('.recharts-wrapper')]

    // Panel 0 takes the crosshair and is left holding a self-hover.
    fireEvent.mouseOver(wrappers[0])
    fireEvent.mouseMove(wrappers[0], { clientX: 300, clientY: 50 })
    await settleHover()
    expect(new Set(cursorXs(container)).size).toBe(1)

    // The finger lands on panel 1. Remove this line and the assertion below
    // fails — that contrast is what makes this a regression guard.
    fireEvent.touchStart(wrappers[1], { touches: [{ clientX: 500, clientY: 50 }] })
    fireEvent.mouseOver(wrappers[1])
    fireEvent.mouseMove(wrappers[1], { clientX: 500, clientY: 50 })
    await settleHover()

    // Panel 0 moved to panel 1's position instead of freezing at 300.
    expect(new Set(cursorXs(container)).size).toBe(1)
  })

  // ── the touch crosshair scrub (ui/useTouchScrub.js) ─────────────────────
  //
  // On touch the crosshair is positioned RELATIVELY: a tap holds it, a
  // horizontal swipe drags it by the distance the finger travelled, so the
  // finger can rest far from the graph shape being read. These drive real touch
  // events against real rendered Recharts panels; the gesture's own mechanics
  // (axis lock, slop, terminal `off`) are covered in useTouchScrub.test.jsx.
  it('leaves the crosshair exactly where it is when a chart is tapped', async () => {
    const { container } = await renderStack()
    await anchorCrosshair(container)
    expect(cursorXs(container)).toEqual(['242', '242', '242', '242'])

    // Tapped on a different panel, and far from the crosshair: absolute
    // positioning would teleport it to 606.
    const wrapper = [...container.querySelectorAll('.recharts-wrapper')][2]
    fireEvent.touchStart(wrapper, touchAt(606))
    fireEvent.touchEnd(wrapper, lifted)
    await settleHover()

    expect(cursorXs(container)).toEqual(['242', '242', '242', '242'])
    expect(container.querySelector('.crosshair-position').textContent).toContain('0:10')
  })

  it('drags the crosshair by the distance the finger travelled, not to the finger', async () => {
    const { container } = await renderStack()
    await anchorCrosshair(container)

    // Finger down at 606 — one sample to the RIGHT of the crosshair — and moved
    // +182px. The crosshair advances one sample, from 242 to 424.
    const wrapper = container.querySelector('.recharts-wrapper')
    fireEvent.touchStart(wrapper, touchAt(606))
    fireEvent.touchMove(wrapper, touchAt(788))
    await settleHover()

    await waitFor(() => expect(cursorXs(container)).toEqual(['424', '424', '424', '424']))
    expect(container.querySelector('.crosshair-position').textContent).toContain('0:20')
  })

  it('accumulates successive swipes, re-reading the crosshair each time', async () => {
    // The gesture reads the rendered cursor per touchstart rather than
    // remembering the last x it dispatched — so a second swipe starts from
    // where the first one left the crosshair, not from the original position.
    const { container } = await renderStack()
    await anchorCrosshair(container)
    const wrapper = container.querySelector('.recharts-wrapper')

    fireEvent.touchStart(wrapper, touchAt(606))
    fireEvent.touchMove(wrapper, touchAt(788))
    fireEvent.touchEnd(wrapper, lifted)
    await settleHover()
    await waitFor(() => expect(cursorXs(container)).toEqual(['424', '424', '424', '424']))

    fireEvent.touchStart(wrapper, touchAt(606))
    fireEvent.touchMove(wrapper, touchAt(788))
    await settleHover()

    await waitFor(() => expect(cursorXs(container)).toEqual(['606', '606', '606', '606']))
    expect(container.querySelector('.crosshair-position').textContent).toContain('0:30')
  })

  it('leaves the crosshair alone on a vertical drag, so reading through still scrolls', async () => {
    const { container } = await renderStack()
    await anchorCrosshair(container)

    const wrapper = container.querySelector('.recharts-wrapper')
    fireEvent.touchStart(wrapper, touchAt(606, 100))
    fireEvent.touchMove(wrapper, touchAt(610, 400))
    await settleHover()

    expect(cursorXs(container)).toEqual(['242', '242', '242', '242'])
  })

  it('places the crosshair at the finger on the first touch, with none on screen to keep', async () => {
    // The one absolute placement, and what makes the gesture discoverable:
    // there is nothing to preserve, so the finger gets to say where it starts.
    const { container } = await renderStack()
    expect(container.querySelectorAll('.recharts-tooltip-cursor')).toHaveLength(0)

    fireEvent.touchStart(container.querySelector('.recharts-wrapper'), touchAt(606))
    await settleHover()

    await waitFor(() => expect(cursorXs(container)).toEqual(['606', '606', '606', '606']))
  })

  it('clamps at the plot edge instead of dragging the crosshair off the chart', async () => {
    // THE trap: a mousemove resolving outside the plot makes Recharts dispatch
    // mouseLeaveChart(), so an unclamped swipe past the end would DELETE the
    // crosshair rather than stopping it on the last sample. "The readout is not
    // blank" is the whole assertion.
    const { container } = await renderStack()
    await anchorCrosshair(container)

    const wrapper = container.querySelector('.recharts-wrapper')
    fireEvent.touchStart(wrapper, touchAt(300))
    fireEvent.touchMove(wrapper, touchAt(3000))
    await settleHover()

    await waitFor(() => expect(cursorXs(container)).toEqual(['788', '788', '788', '788']))
    expect(container.querySelector('.crosshair-position').textContent).toContain('0:40')
    expect([...container.querySelectorAll('.crosshair-slot')].every((s) => s.textContent !== '')).toBe(true)
  })

  it('hands a scrub over to the browser when a second finger lands', async () => {
    // One finger does exactly one thing, and a second finger is now the PAGE
    // zoom — the app's own pinch is gone. So the scrub abandons, and nothing
    // the app draws may move in response.
    const { container } = await renderStack()
    await anchorCrosshair(container)
    const before = [...container.querySelectorAll('.metric-panel')].map(pathXs)

    const wrapper = container.querySelector('.recharts-wrapper')
    fireEvent.touchStart(wrapper, touchAt(606))
    fireEvent.touchMove(wrapper, touchAt(788))
    await settleHover()
    const scrubbedTo = cursorXs(container)

    fireEvent.touchStart(wrapper, twoFingerTouch)
    fireEvent.touchMove(wrapper, twoFingerTouch)
    await settleHover()

    // No zoom, and — the half the app has to provide itself, since Recharts
    // would otherwise drag the crosshair to the fingers — no crosshair move.
    expect([...container.querySelectorAll('.metric-panel')].map(pathXs)).toEqual(before)
    expect(cursorXs(container)).toEqual(scrubbedTo)
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument()
  })

  it('drops a panel when its metric is toggled off via ChartViewContext', async () => {
    const { container } = await renderStack({ extra: <ToggleMetric metricId="cadence" /> })
    expect(container.querySelectorAll('.metric-panel')).toHaveLength(4)

    fireEvent.click(screen.getByText('toggle-cadence'))
    await waitFor(() => expect(container.querySelectorAll('.metric-panel')).toHaveLength(3))

    const colors = [...container.querySelectorAll('.metric-panel')].map((p) =>
      p.querySelector('.metric-line .recharts-curve').getAttribute('stroke'),
    )
    expect(colors).not.toContain(metricRegistry.cadence.color)
  })

  // Kept as a negative regression guard rather than deleted: the Brush was
  // replaced because its ~5px travellers are unusable on touch
  // (ARCHITECTURE.md §13 Route B), and a stray `showBrush` prop creeping back
  // in would otherwise go unnoticed.
  it('renders no Brush on any panel', async () => {
    const { container } = await renderStack()
    expect(container.querySelectorAll('.recharts-brush')).toHaveLength(0)
  })

  it('dragging an edge narrows the x-domain identically across every panel', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    const spreadBefore = panels.map(xSpread)

    // The start edge in to a quarter across the plot, i.e. t = 10 s.
    await dragWindowEdge(container, { edge: 'start', from: 60, to: 242 })

    await waitFor(() => {
      const panelsNow = [...container.querySelectorAll('.metric-panel')]
      // Points spreading further apart in pixels means the scale narrowed —
      // the same samples now occupy more of the plot.
      panelsNow.forEach((panel, i) => expect(xSpread(panel)).toBeGreaterThan(spreadBefore[i]))
      // And every panel must land on the IDENTICAL x positions, since they
      // share one controlled zoomDomain. Comparing pixel positions rather than
      // point counts is what makes this a real synchronisation assertion.
      const xs = panelsNow.map((panel) => pathXs(panel).join(','))
      expect(new Set(xs).size).toBe(1)
    })
  })

  // THE regression the whole gutter design exists to prevent, and the one
  // manual check that could be automated. It broke the pinch in exactly the
  // same way it would break the drag, which is why this pair was ported rather
  // than dropped with the gesture it was written for.
  //
  // The edge must land where the pointer is. Route rightInset past the drag and
  // it solves against a 728px plot while Recharts draws a 684px one: the
  // fraction is read at the wrong width, and the error grows with distance from
  // the left edge — nothing at the left, over a second of drift near the right.
  //
  // Asserted through the window itself (aria-valuenow, in seconds) rather than
  // through pixel constants, because the two cases have different plot widths
  // BY CONSTRUCTION and that is the whole point.
  it('lands the edge on the value under the pointer while an overlay is on', async () => {
    const { container } = await renderStack({
      extra: <ToggleStat metricId="heartRate" statKind="d1" />,
    })
    const panel = () => [...container.querySelectorAll('.metric-panel')][0]

    fireEvent.click(screen.getByText('toggle-heartRate-d1'))
    await waitFor(() => expect(panel().querySelectorAll('.recharts-yAxis')).toHaveLength(2))

    // Three quarters across the NARROWED plot ({left: 60, width: 684}), and
    // near the right edge, where a mis-measured width does the most damage.
    await dragWindowEdge(container, { edge: 'start', from: 60, to: 60 + 0.75 * 684 })

    // 0.75 of the unzoomed 0–40 s view. Measured at 728px it would read 28.2.
    await waitFor(() => expect(handlesOf(panel())[0]).toHaveAttribute('aria-valuenow', '30'))
  })

  it('lands it on the same value with no overlay, so the gutter is what changed', async () => {
    // The control. Identical gesture at rightInset === 0 — if this failed too,
    // the test above would be measuring the gesture in general, not the gutter.
    const { container } = await renderStack()
    const panel = () => [...container.querySelectorAll('.metric-panel')][0]

    await dragWindowEdge(container, { edge: 'start', from: 60, to: 60 + 0.75 * 728 })

    await waitFor(() => expect(handlesOf(panel())[0]).toHaveAttribute('aria-valuenow', '30'))
  })

  it('a horizontal trackpad swipe translates the zoomed curve without rescaling it', async () => {
    const { container } = await renderStack()
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)

    await trimToMidWindow(container)
    await waitFor(() => expect(tickSeconds(tickLabels(bottomPanel()).at(-1))).toBeLessThan(40))
    const before = pathXs(bottomPanel())

    // The gesture the browser delivers as a wheel event carrying deltaX. 91px
    // is an eighth of the 728px plot.
    fireEvent(
      container.querySelector('.chart-stack'),
      new WheelEvent('wheel', { deltaX: 91, deltaY: 0, cancelable: true, bubbles: true }),
    )

    await waitFor(() => {
      const after = pathXs(bottomPanel())
      // Rendered proof that width was preserved end-to-end, and stronger than
      // asserting on context state: the samples moved left as one, and the
      // pixel gaps between them — i.e. the scale — did not change.
      expect(after[0]).toBeLessThan(before[0])
      const gaps = (xs) => xs.slice(1).map((x, i) => x - xs[i])
      gaps(after).forEach((gap, i) => expect(gap).toBeCloseTo(gaps(before)[i], 6))
    })
  })

  it('shows a Reset zoom control only once zoomed, and restores the full domain', async () => {
    const { container } = await renderStack()
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)
    // Absent at rest, so it never lands in an idle screenshot.
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument()

    await trimToMidWindow(container)
    await waitFor(() => expect(tickSeconds(tickLabels(bottomPanel()).at(-1))).toBeLessThan(40))

    fireEvent.click(screen.getByRole('button', { name: /reset zoom/i }))

    await waitFor(() => expect(tickLabels(bottomPanel())).toEqual(['0:00', '0:10', '0:20', '0:30', '0:40']))
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument()
  })

  // §6 was reversed here: stats used to be pinned to the whole activity. The
  // number is asserted exactly, not just "it changed" — a windowed slice that
  // forgot to recompute the window's totals still changes most chips, and
  // would leave average pace silently reporting the whole ride.
  it('reports the zoom window in the stat chips, and the whole activity again after reset', async () => {
    const { container } = await renderStack({ extra: <ToggleStat metricId="heartRate" statKind="avg" /> })
    // Second panel is heart rate (metricOrder ∩ availableMetrics). Stats are
    // off until switched on, so there is no chip to read before this click.
    fireEvent.click(screen.getByText('toggle-heartRate-avg'))
    const hrChip = () => [...container.querySelectorAll('.metric-panel')][1].querySelector('.stat-chip')?.textContent
    // Whole activity, time-weighted, last sample weighing 0:
    // (120 + 130 + 150 + 140) × 10 / 40 = 135.
    await waitFor(() => expect(hrChip()).toContain('AVG 135 bpm'))

    await trimToMidWindow(container)

    // waitFor rather than a sync getBy: aggregation runs behind
    // useDeferredValue, so the chips settle a frame or two after the line
    // moves, by design.
    await waitFor(() => {
      // The window holds the samples at 10/20/30 s:
      // (130 + 150) × 10 / 20 = 140.
      expect(hrChip()).toContain('AVG 140 bpm')
    })

    fireEvent.click(screen.getByRole('button', { name: /reset zoom/i }))
    await waitFor(() => expect(hrChip()).toContain('AVG 135 bpm'))
  })

  // The header's duration and the chips read the same window through the same
  // function (stats/statsBasis.js elapsedTimeFor), but on two different
  // deadlines, and this is where that split is pinned. The header is rendered
  // here rather than in ActivityHeader.test.jsx because the difference only
  // shows under a real gesture: a lone setZoomDomain inside act() settles a
  // deferred render too, so nothing short of the pinch path can tell the two
  // apart. Put the duration back behind useDeferredValue and the synchronous
  // assertion below fails while everything else stays green.
  it('updates the header duration mid-gesture, ahead of the chips', async () => {
    const withTotalTime = { ...fixtureActivity, totalTime: 40, name: 'Test run' }
    const { container } = await renderStack({
      activity: withTotalTime,
      // No <ActivityHeader /> of its own — renderStack's harness already renders
      // one, and a second would give `.activity-duration` two matches.
      extra: <ToggleStat metricId="heartRate" statKind="avg" />,
    })
    fireEvent.click(screen.getByText('toggle-heartRate-avg'))
    const duration = () => container.querySelector('.activity-duration').textContent
    const hrChip = () => [...container.querySelectorAll('.metric-panel')][1].querySelector('.stat-chip')?.textContent
    await waitFor(() => expect(hrChip()).toContain('AVG 135 bpm'))
    expect(duration()).toBe('0:40')

    // Left LIVE, no pointerup: the window holds the samples at 10/20/30 s and
    // the hand is still on the handle.
    await dragWindowEdge(container, { edge: 'start', from: 60, to: 242 })
    await dragWindowEdge(container, { edge: 'end', from: 788, to: 606, release: false })

    // NO waitFor: one frame after the gesture emitted, the duration already
    // reports the window. Under a sustained gesture this is the whole feature
    // — the urgent update restarts the deferred render every frame, so a
    // deferred duration does not lag by a frame, it does not move at all until
    // the hand comes off.
    expect(duration()).toBe('0:20')

    // And the chips still settle behind it, deliberately: making them live
    // would put a sort per metric over the full-resolution series on every
    // frame, which is the cost this design refuses to pay.
    await waitFor(() => expect(hrChip()).toContain('AVG 140 bpm'))
    expect(duration()).toBe('0:20')
  })

  // Encodes the decision that there is no one-finger drag-to-pan, so it can't
  // be reintroduced by accident: one finger on a chart must stay page scroll.
  it('ignores a single-finger drag', async () => {
    const { container } = await renderStack()
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)
    const before = pathXs(bottomPanel())

    const stack = container.querySelector('.chart-stack')
    const touch = (clientX) => ({ pointerId: 1, pointerType: 'touch', clientX, clientY: 100 })
    fireEvent.pointerDown(stack, touch(606))
    fireEvent.pointerMove(window, touch(242))
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))

    expect(pathXs(bottomPanel())).toEqual(before)
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument()
  })

  // ── The zoom window's faded shoulders and its two draggable edges ─────────
  //
  // The overlay's own geometry is unit-tested in ZoomWindowOverlay.test.jsx and
  // the gesture in useEdgeDrag.test.jsx; these are the integration facts — that
  // every panel gets handles, that dragging one trims the window the stats and
  // the header report, and that the plot does not rescale under the hand.

  const handlesOf = (panel) => [...panel.querySelectorAll('.zoom-handle')]

  it('parks a handle on each plot edge when unzoomed, with no shoulder drawn', async () => {
    // Unconditional, deliberately: parked handles are the affordance for
    // STARTING a trim. At zero width nothing is dimmed, so an idle chart still
    // looks exactly as it did before any of this existed.
    const { container } = await renderStack()
    for (const panel of container.querySelectorAll('.metric-panel')) {
      expect(handlesOf(panel).map((h) => h.style.left)).toEqual(['0%', '100%'])
      expect(panel.querySelector('.zoom-window__shoulder').style.width).toBe('0%')
    }
  })

  it('shows the window against its faded shoulders on every panel once zoomed', async () => {
    const { container } = await renderStack()

    await trimToMidWindow(container)

    await waitFor(() => {
      const lefts = [...container.querySelectorAll('.metric-panel')].map((p) => handlesOf(p)[0].style.left)
      // Every panel agrees, because the fractions are computed once for the
      // whole stack — and the window is genuinely inside the plotted view.
      expect(new Set(lefts).size).toBe(1)
      expect(Number.parseFloat(lefts[0])).toBeGreaterThan(0)
      expect(Number.parseFloat(lefts[0])).toBeLessThan(50)
    })
  })

  it('trims the window from the start when the start handle is dragged inward', async () => {
    const withTotalTime = { ...fixtureActivity, totalTime: 40, name: 'Test run' }
    const { container } = await renderStack({ activity: withTotalTime })
    const duration = () => container.querySelector('.activity-duration').textContent
    expect(duration()).toBe('0:40')

    const startHandle = handlesOf([...container.querySelectorAll('.metric-panel')][0])[0]
    fireEvent.pointerDown(startHandle, { clientX: 60 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    // Half way across the plot of an unzoomed 0–40 s activity.
    fireEvent.pointerMove(window, { clientX: 424 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))

    // The header reports the WINDOW, live, exactly as it does mid-pinch.
    expect(duration()).toBe('0:20')
    fireEvent.pointerUp(window, { clientX: 424 })
    await waitFor(() => expect(duration()).toBe('0:20'))
  })

  it('does NOT rescale the plot while an edge is being dragged, and re-fits once on release', async () => {
    // §2.2's runaway: a view that tracked the window live would redraw the
    // handle at a fixed plot fraction every frame, always on the far side of
    // the pointer, and the window would shrink without converging. The freeze
    // is what makes the drag land where the pointer is — and it is invisible in
    // any test that only looks at the window, hence this one looks at the line.
    const { container } = await renderStack()
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)
    const before = pathXs(bottomPanel())

    const startHandle = handlesOf([...container.querySelectorAll('.metric-panel')][0])[0]
    fireEvent.pointerDown(startHandle, { clientX: 60 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    fireEvent.pointerMove(window, { clientX: 424 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))

    // The graph has not moved under the hand, though the window has changed.
    expect(pathXs(bottomPanel())).toEqual(before)
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeInTheDocument()

    fireEvent.pointerUp(window, { clientX: 424 })
    await waitFor(() => expect(pathXs(bottomPanel())).not.toEqual(before))
  })

  it('gives back one shoulder per outward drag, and Reset zoom is the way back to all of it', async () => {
    // A drag is clamped into the PLOTTED VIEW, so what a single outward drag can
    // restore is exactly the context on screen — the faded shoulder is the
    // affordance for how much. Widening past it would mean either a hidden gain
    // on the pointer or a live view, and a live view is the runaway above.
    // Getting the whole activity back in one action is what Reset zoom is for;
    // that control exists for the same reason on the pinch side, where unwinding
    // a deep zoom otherwise takes several gestures.
    const withTotalTime = { ...fixtureActivity, totalTime: 40, name: 'Test run' }
    const { container } = await renderStack({ activity: withTotalTime })
    const duration = () => container.querySelector('.activity-duration').textContent
    const startHandle = () => handlesOf([...container.querySelectorAll('.metric-panel')][0])[0]

    fireEvent.pointerDown(startHandle(), { clientX: 60 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    fireEvent.pointerMove(window, { clientX: 424 })
    fireEvent.pointerUp(window, { clientX: 424 })
    await waitFor(() => expect(duration()).toBe('0:20'))

    // The window is 20–40 s inside a view of 15–40 s: one shoulder of context.
    expect(startHandle()).toHaveAttribute('aria-valuenow', '20')

    // Back out to the left edge of the plot: the window grows to the start of
    // the view it was drawn in, i.e. by exactly that shoulder, and no further.
    // (The duration is unchanged at 0:20 — this fixture samples every 10 s, so
    // 5 s of extra window contains nothing new to report. The window did move.)
    fireEvent.pointerDown(startHandle(), { clientX: 424 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    fireEvent.pointerMove(window, { clientX: 0 })
    fireEvent.pointerUp(window, { clientX: 0 })
    await waitFor(() => expect(startHandle()).toHaveAttribute('aria-valuenow', '15'))
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /reset zoom/i }))
    await waitFor(() => expect(duration()).toBe('0:40'))
    expect(handlesOf([...container.querySelectorAll('.metric-panel')][0]).map((h) => h.style.left)).toEqual([
      '0%',
      '100%',
    ])
  })

  it('reads the crosshair out at the boundary while an edge is dragged', async () => {
    // Trimming is done by watching the numbers, so the panels have to report at
    // the edge being moved — and they must still be reporting after the hand
    // comes off, the same choice useTouchScrub makes.
    const { container } = await renderStack()

    const startHandle = handlesOf([...container.querySelectorAll('.metric-panel')][0])[0]
    fireEvent.pointerDown(startHandle, { clientX: 60 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    fireEvent.pointerMove(window, { clientX: 424 })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    await settleHover()

    await waitFor(() => expect(cursorXs(container)).toEqual(['424', '424', '424', '424']))
    fireEvent.pointerUp(window, { clientX: 424 })
    await settleHover()
    expect(container.querySelectorAll('.recharts-tooltip-cursor')).toHaveLength(4)
  })

  it('resets the zoom to the full domain when the x-axis mode switches', async () => {
    const { container } = await renderStack({ extra: <SwitchXMode mode="distance" /> })
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)

    await trimToMidWindow(container)
    await waitFor(() => expect(tickSeconds(tickLabels(bottomPanel()).at(-1))).toBeLessThan(40))

    fireEvent.click(screen.getByText('switch-x-distance'))

    // A stale numeric zoomDomain left over from time mode (e.g. [0, 20])
    // would misread as a distance domain and clip the distance axis to
    // 0–20m instead of the full 0–200m track — resetting on mode switch
    // avoids that silent bug.
    await waitFor(() =>
      expect(tickLabels(bottomPanel())).toEqual(['0m', '50m', '100m', '150m', '200m']),
    )
    await waitFor(() => expect(pathXs(bottomPanel())).toHaveLength(5))
  })
})

// The route map panel, as it behaves inside the real stack. Unit-level coverage
// of the drawing itself is in MapPanel.test.jsx; these are the integration
// facts — where it sits, that it does not disturb the gesture, and that the
// shared crosshair reaches it.
describe('ChartStack with a route', () => {
  // The bus is module-level state and outlives Testing Library's cleanup. In
  // practice HoverPublisher's unmount already publishes null, but a hover
  // leaking into the next test's fresh mount would be a maddening failure to
  // diagnose, so it is cleared explicitly. See ui/crosshairBus.js.
  afterEach(() => resetCrosshairBus())

  const mapPanel = (container) => container.querySelector('.map-panel')
  /** The marker layer — the third of MapPanel's three canvases. */
  const markerCalls = (container) =>
    container.querySelectorAll('.map-panel__layer')[2].getContext('2d').calls

  it('renders the map first, above every chart', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    const panels = [...container.querySelectorAll('.map-panel, .metric-panel')]

    expect(panels[0]).toHaveClass('map-panel')
    expect(panels).toHaveLength(5) // the map plus the four metric panels
  })

  // The availability gate is `activity.track != null` and nothing else — in
  // particular NOT an entry in availableMetrics, which is hashed into the
  // activity's id (domain/activityKey.js).
  it('renders no map panel, and no toggle, for an activity with no GPS', async () => {
    const { container } = await renderStack()
    expect(mapPanel(container)).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Route' })).not.toBeInTheDocument()
  })

  it('leaves the metric panels’ heights untouched', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    const heights = [...container.querySelectorAll('.metric-panel')].map((p) => p.style.minHeight)
    expect(heights).toEqual(['200px', '140px', '140px', '140px'])
    expect(mapPanel(container).style.minHeight).toBe('240px')
  })

  it('hides and restores the map from the toolbar', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    const toggle = screen.getByRole('checkbox', { name: 'Route' })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)
    await waitFor(() => expect(mapPanel(container)).toBeNull())
    // The toggle itself must survive, or there is no way back: a hidden panel
    // has no head of its own.
    expect(screen.getByRole('checkbox', { name: 'Route' })).not.toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Route' }))
    await waitFor(() => expect(mapPanel(container)).not.toBeNull())
  })

  // ⚠️ TRAP 3, pinned mechanically rather than by memory.
  //
  // `plotRectOf` measures the FIRST `.recharts-surface` in the stack and
  // applies that one rect to gestures anywhere on it. The map is safe above the
  // charts precisely because it renders canvases and no surface — so the first
  // surface is still the first MetricPanel and the arithmetic is unchanged. If
  // the map ever grows an SVG chart of its own, this is what fails.
  it('still zooms on an edge drag, with the map above the charts', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    const panels = [...container.querySelectorAll('.metric-panel')]
    const spreadBefore = panels.map(xSpread)

    await dragWindowEdge(container, { edge: 'start', from: 60, to: 242 })

    await waitFor(() => {
      const panelsNow = [...container.querySelectorAll('.metric-panel')]
      panelsNow.forEach((panel, i) => expect(xSpread(panel)).toBeGreaterThan(spreadBefore[i]))
      const xs = panelsNow.map((panel) => pathXs(panel).join(','))
      expect(new Set(xs).size).toBe(1)
    })
  })

  it('renders no .recharts-surface of its own, which is why the drag is safe', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    expect(mapPanel(container).querySelector('.recharts-surface')).toBeNull()
    // And the first surface in the whole stack is still a metric panel's.
    const firstSurface = container.querySelector('.recharts-surface')
    expect(firstSurface.closest('.metric-panel')).not.toBeNull()
  })

  it('moves the marker along the route as a chart is hovered', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    expect(markerCalls(container).filter((c) => c.name === 'arc')).toHaveLength(0)

    await anchorCrosshair(container, 300)
    const first = markerCalls(container).findLast((c) => c.name === 'arc')
    expect(first).toBeDefined()

    await anchorCrosshair(container, 600)
    const second = markerCalls(container).findLast((c) => c.name === 'arc')
    expect(second.args[0]).toBeGreaterThan(first.args[0])
  })

  // Only the FIRST visible panel publishes — every panel is synced to the same
  // sample, so N publishers would be N redundant writes per hover frame.
  it('drives the marker from a hover on any panel, through syncId', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    const lastPanel = [...container.querySelectorAll('.metric-panel')].at(-1)

    fireEvent.mouseOver(lastPanel.querySelector('.recharts-wrapper'))
    fireEvent.mouseMove(lastPanel.querySelector('.recharts-wrapper'), { clientX: 300, clientY: 50 })
    await settleHover()

    expect(markerCalls(container).filter((c) => c.name === 'arc').length).toBeGreaterThan(0)
  })

  it('ships the basemap off, so the stack asks the network for nothing', async () => {
    const { container } = await renderStack({ activity: routedActivity })
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked()
    expect(mapPanel(container).querySelector('.map-panel__attribution')).toBeNull()
  })
})

// setupTests.js stubs matchMedia to matches:false ("not narrow"), which is the
// branch every assertion above expects. This block reassigns it and restores
// it in an afterEach — without the restore, every later test file in the run
// would inherit a phone-sized viewport.
describe('ChartStack on a narrow viewport', () => {
  const realMatchMedia = window.matchMedia

  const goNarrow = () => {
    window.matchMedia = (query) => ({
      matches: query.includes('max-width: 720px'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })
  }

  afterEach(() => {
    window.matchMedia = realMatchMedia
  })

  it('shrinks the map panel too, since it is a JS number like the others', async () => {
    goNarrow()
    const { container } = await renderStack({ activity: routedActivity })
    expect(container.querySelector('.map-panel').style.minHeight).toBe('180px')
  })

  it('cuts panel heights by ~25%, keeping the §9 promise the Brush-era constants never did', async () => {
    goNarrow()

    const { container } = await renderStack()
    const heights = [...container.querySelectorAll('.metric-panel')].map((p) => p.style.minHeight)
    // 200→150 and 140→105: exactly 25% off both, and no Brush allowance on the
    // bottom panel any more.
    expect(heights).toEqual(['150px', '105px', '105px', '105px'])
  })
})
