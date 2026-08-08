import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useEffect } from 'react'
import { ActivityHeader } from './ActivityHeader.jsx'
import { ChartStack } from './ChartStack.jsx'
import { AppProviders } from '../app/providers.jsx'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { metricRegistry, metricOrder } from '../metrics/metricRegistry.js'

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

// Pinches the stack: two touch pointers down, then both moved, then a frame.
// setupTests.js hard-assigns one fixed {left:0, width:800} rect to EVERY
// element, so the plot area is {left: 60, width: 728} — and 728 = 8 × 91, so
// eighth-fractions land on integer clientX: 0.125→151, 0.25→242, 0.5→424,
// 0.75→606, 0.875→697.
//
// Pointer (not Touch) events, because jsdom 30 has no Touch constructor —
// which is one of the reasons the gesture is built on Pointer Events in the
// first place. See usePinchZoom.test.jsx for the gesture's own coverage.
async function pinchStack(container, { from, to }) {
  const stack = container.querySelector('.chart-stack')
  const touch = (clientX, pointerId) => ({ pointerId, pointerType: 'touch', clientX, clientY: 100 })
  fireEvent.pointerDown(stack, touch(from[0], 1))
  fireEvent.pointerDown(stack, touch(from[1], 2))
  fireEvent.pointerMove(window, touch(to[0], 1))
  fireEvent.pointerMove(window, touch(to[1], 2))
  // Emission is rAF-coalesced (usePinchZoom), so nothing has been written to
  // zoomDomain until a frame passes.
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
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
  const d = panel.querySelector('.recharts-line .recharts-curve').getAttribute('d')
  return [...d.matchAll(/[ML](-?[\d.]+),/g)].map(([, x]) => Number(x))
}

function xSpread(panel) {
  const xs = pathXs(panel)
  return Math.max(...xs) - Math.min(...xs)
}

// The elapsed time the chart is CURRENTLY drawing under a given screen x, read
// back out of the rendered path. The fixture's samples are evenly spaced in t
// (0…40s) and the axis is linear, so the first and last rendered points define
// the mapping exactly — no interpolation table needed.
//
// This is how the anchored-pinch invariant becomes observable: "the value under
// a stationary finger does not move" is the defining property of the gesture,
// and it is the property that breaks when the gesture measures a plot of a
// different width than the one Recharts drew.
function tAtClientX(panel, clientX) {
  const xs = pathXs(panel)
  return ((clientX - xs[0]) / (xs.at(-1) - xs[0])) * 40
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

async function renderStack({ activity = fixtureActivity, extra = null } = {}) {
  const utils = render(
    <AppProviders source={makeSource(activity)}>
      <Loader />
      {extra}
      <ChartStack />
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
    const colors = [...panels].map((p) => p.querySelector('.recharts-line .recharts-curve').getAttribute('stroke'))
    expect(colors).toEqual(expectedOrder.map((id) => metricRegistry[id].color))
  })

  it('only renders panels for metrics the activity actually has data for', async () => {
    const sparse = { ...fixtureActivity, availableMetrics: ['heartRate', 'altitude'] }
    const { container } = await renderStack({ activity: sparse })
    const panels = container.querySelectorAll('.metric-panel')
    expect(panels).toHaveLength(2)
    const colors = [...panels].map((p) => p.querySelector('.recharts-line .recharts-curve').getAttribute('stroke'))
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
  // narrows the plot, and the pinch gesture measures ONE .recharts-surface —
  // the first in the stack — then applies that rect to gestures anywhere on it.
  // So the gutter has to be reserved on every visible panel the moment any one
  // of them has an overlay. Reserve it per panel instead and the failures are
  // silent: lines horizontally offset between panels, and a pinch that drifts
  // 44px out from under the fingers.
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

  // The mobile freeze (useTouchHoverHandoff): a panel that has been touched
  // holds its OWN Recharts hover, which outranks the incoming syncId event, so
  // without the handoff it stays pinned at its last index while every other
  // panel follows the new finger. mouseOver+mouseMove is the same
  // `setMouseOverAxisIndex` state a touchmove produces, so it reproduces the
  // stale hover without needing touch events jsdom can't build.
  it('releases a previously-touched panel back to the synced crosshair when another panel is touched', async () => {
    const { container } = await renderStack()
    const wrappers = [...container.querySelectorAll('.recharts-wrapper')]
    const settle = async () => {
      // Recharts' mouse middleware is rAF-throttled.
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const cursorXs = () =>
      wrappers.map((w) => w.querySelector('.recharts-tooltip-cursor').getAttribute('d').match(/M(-?[\d.]+),/)[1])

    // Panel 0 takes the crosshair and is left holding a self-hover.
    fireEvent.mouseOver(wrappers[0])
    fireEvent.mouseMove(wrappers[0], { clientX: 300, clientY: 50 })
    await settle()
    expect(new Set(cursorXs()).size).toBe(1)

    // The finger lands on panel 1. Remove this line and the assertion below
    // fails — that contrast is what makes this a regression guard.
    fireEvent.touchStart(wrappers[1], { touches: [{ clientX: 500, clientY: 50 }] })
    fireEvent.mouseOver(wrappers[1])
    fireEvent.mouseMove(wrappers[1], { clientX: 500, clientY: 50 })
    await settle()

    // Panel 0 moved to panel 1's position instead of freezing at 300.
    expect(new Set(cursorXs()).size).toBe(1)
  })

  it('drops a panel when its metric is toggled off via ChartViewContext', async () => {
    const { container } = await renderStack({ extra: <ToggleMetric metricId="cadence" /> })
    expect(container.querySelectorAll('.metric-panel')).toHaveLength(4)

    fireEvent.click(screen.getByText('toggle-cadence'))
    await waitFor(() => expect(container.querySelectorAll('.metric-panel')).toHaveLength(3))

    const colors = [...container.querySelectorAll('.metric-panel')].map((p) =>
      p.querySelector('.recharts-line .recharts-curve').getAttribute('stroke'),
    )
    expect(colors).not.toContain(metricRegistry.cadence.color)
  })

  // Kept as a negative regression guard rather than deleted: the Brush was
  // replaced by pinch-to-zoom because its ~5px travellers are unusable on
  // touch (ARCHITECTURE.md §13 Route B), and a stray `showBrush` prop
  // creeping back in would otherwise go unnoticed.
  it('renders no Brush on any panel', async () => {
    const { container } = await renderStack()
    expect(container.querySelectorAll('.recharts-brush')).toHaveLength(0)
  })

  it('pinching narrows the x-domain identically across every panel', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    const spreadBefore = panels.map(xSpread)

    // Fingers spread from the quarter points out towards the edges.
    await pinchStack(container, { from: [242, 606], to: [151, 697] })

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
  // manual check that could be automated. `pinchStack`'s documented clientX
  // constants assume rightInset === 0 (plot {left: 60, width: 728}); with an
  // overlay on the plot is {left: 60, width: 684}, so this test asserts the
  // invariant rather than pixel constants.
  //
  // A finger held still must keep the same instant under it. Route rightInset
  // past `usePinchZoom` and the gesture solves against a 728px plot while
  // Recharts draws a 684px one: the anchors are captured at the wrong
  // fractions, and the error grows with distance from the left edge — ~1px at
  // the quarter point, over a second of drift for a finger near the right.
  it('keeps the instant under a stationary finger pinned while an overlay is on', async () => {
    const { container } = await renderStack({
      extra: <ToggleStat metricId="heartRate" statKind="d1" />,
    })
    const panel = () => [...container.querySelectorAll('.metric-panel')][0]

    fireEvent.click(screen.getByText('toggle-heartRate-d1'))
    await waitFor(() => expect(panel().querySelectorAll('.recharts-yAxis')).toHaveLength(2))

    // Anchored near the RIGHT edge, where a mis-measured plot width does the
    // most damage — at the left edge the error is nearly zero either way.
    const pinnedAt = 697
    const before = tAtClientX(panel(), pinnedAt)

    await pinchStack(container, { from: [606, pinnedAt], to: [515, pinnedAt] })

    await waitFor(() => expect(xSpread(panel())).toBeGreaterThan(0))
    expect(tAtClientX(panel(), pinnedAt)).toBeCloseTo(before, 6)
  })

  it('keeps that same finger pinned with no overlay, so the gutter is what changed', async () => {
    // The control. Identical gesture at rightInset === 0 — if this failed too,
    // the test above would be measuring the gesture in general, not the gutter.
    const { container } = await renderStack()
    const panel = () => [...container.querySelectorAll('.metric-panel')][0]
    const pinnedAt = 697
    const before = tAtClientX(panel(), pinnedAt)

    await pinchStack(container, { from: [606, pinnedAt], to: [515, pinnedAt] })

    await waitFor(() => expect(xSpread(panel())).toBeGreaterThan(0))
    expect(tAtClientX(panel(), pinnedAt)).toBeCloseTo(before, 6)
  })

  it('a horizontal trackpad swipe translates the zoomed curve without rescaling it', async () => {
    const { container } = await renderStack()
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)

    await pinchStack(container, { from: [242, 606], to: [151, 697] })
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

    await pinchStack(container, { from: [242, 606], to: [151, 697] })
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

    await pinchStack(container, { from: [242, 606], to: [151, 697] })

    // waitFor rather than a sync getBy: aggregation runs behind
    // useDeferredValue, so the chips settle a frame or two after the line
    // moves, by design.
    await waitFor(() => {
      // The pinch lands on ≈6.7–33.3s, i.e. the samples at 10/20/30s:
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
      extra: (
        <>
          <ActivityHeader />
          <ToggleStat metricId="heartRate" statKind="avg" />
        </>
      ),
    })
    fireEvent.click(screen.getByText('toggle-heartRate-avg'))
    const duration = () => container.querySelector('.activity-duration').textContent
    const hrChip = () => [...container.querySelectorAll('.metric-panel')][1].querySelector('.stat-chip')?.textContent
    await waitFor(() => expect(hrChip()).toContain('AVG 135 bpm'))
    expect(duration()).toBe('0:40')

    // The pinch lands on ≈6.7–33.3 s, i.e. the samples at 10/20/30 s.
    await pinchStack(container, { from: [242, 606], to: [151, 697] })

    // NO waitFor: one frame after the gesture emitted, the duration already
    // reports the window. Under a sustained gesture this is the whole feature
    // — emit()'s urgent update restarts the deferred render every frame, so a
    // deferred duration does not lag by a frame, it does not move at all until
    // the fingers stop.
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

  it('resets the zoom to the full domain when the x-axis mode switches', async () => {
    const { container } = await renderStack({ extra: <SwitchXMode mode="distance" /> })
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)

    await pinchStack(container, { from: [242, 606], to: [151, 697] })
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

// setupTests.js stubs matchMedia to matches:false ("not narrow"), which is the
// branch every assertion above expects. This block reassigns it and restores
// it in an afterEach — without the restore, every later test file in the run
// would inherit a phone-sized viewport.
describe('ChartStack on a narrow viewport', () => {
  const realMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = realMatchMedia
  })

  it('cuts panel heights by ~25%, keeping the §9 promise the Brush-era constants never did', async () => {
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

    const { container } = await renderStack()
    const heights = [...container.querySelectorAll('.metric-panel')].map((p) => p.style.minHeight)
    // 200→150 and 140→105: exactly 25% off both, and no Brush allowance on the
    // bottom panel any more.
    expect(heights).toEqual(['150px', '105px', '105px', '105px'])
  })
})
