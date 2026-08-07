import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
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

function SwitchXMode({ mode }) {
  const { setXMode } = useChartView()
  return <button onClick={() => setXMode(mode)}>switch-x-{mode}</button>
}

// Drags a recharts <Brush> traveller by simulating the real mouse sequence
// it listens for (mousedown on the traveller, mousemove/mouseup on window).
// jsdom's MouseEvent only honors `clientX` — `pageX` is a getter that just
// returns `clientX` (no scroll-offset support) — so the delta must be passed
// as `clientX` or Brush's internal drag math silently sees no movement.
function dragBrushEndTraveller(panel, deltaX) {
  const travellers = [...panel.querySelectorAll('.recharts-brush-traveller')]
  const endTraveller = travellers[1]
  const startX = Number(endTraveller.querySelector('rect').getAttribute('x'))
  fireEvent.mouseDown(endTraveller, { clientX: startX, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: startX + deltaX, clientY: 0 })
  fireEvent.mouseUp(window)
}

function linePointCount(panel) {
  const d = panel.querySelector('.recharts-line .recharts-curve').getAttribute('d')
  return [...d.matchAll(/[ML]/g)].length
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
    // share a line color (they never render together), so disambiguate via
    // the default-on avg stat label's unit text instead.
    const cycling = { ...fixtureActivity, sport: 'cycling', availableMetrics: ['pace', 'speed', 'heartRate'] }
    const { container } = await renderStack({ activity: cycling })
    const panels = container.querySelectorAll('.metric-panel')
    expect(panels).toHaveLength(2) // only one "how fast" panel, not both pace and speed
    expect(panels[0].textContent).toContain('km/h')
    expect(panels[0].textContent).not.toContain('min/km')
  })

  it('gives the first panel more height than the rest, and the bottom panel extra room for the brush', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    // minHeight (not height) so the panel can grow past the chart's own
    // height to fit the stat-chip row below it, instead of clipping it.
    const heights = panels.map((p) => p.style.minHeight)
    expect(heights[0]).toBe('200px')
    expect(heights.slice(1, -1)).toEqual(['140px', '140px'])
    // Bottom panel (altitude) hosts the Brush, which needs its own space so
    // it doesn't eat into the plot area's usual height.
    expect(heights.at(-1)).toBe('170px')
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

  it('renders a Brush control only on the bottom panel', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    const brushCounts = panels.map((p) => p.querySelectorAll('.recharts-brush').length)
    expect(brushCounts.slice(0, -1)).toEqual([0, 0, 0])
    expect(brushCounts.at(-1)).toBe(1)
  })

  it('dragging the brush narrows the x-domain identically across every panel', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    expect(panels.map(linePointCount)).toEqual([5, 5, 5, 5])

    dragBrushEndTraveller(panels.at(-1), -300)

    await waitFor(() => {
      // Recharts drops samples outside the XAxis domain from the line path
      // entirely rather than clamping them, so a narrower domain shows up
      // as fewer points — and all four panels must drop to the exact same
      // count, since they share one controlled zoomDomain.
      const counts = panels.map(linePointCount)
      expect(counts.every((c) => c < 5)).toBe(true)
      expect(new Set(counts).size).toBe(1)
    })
  })

  it('resets the zoom to the full domain when the x-axis mode switches', async () => {
    const { container } = await renderStack({ extra: <SwitchXMode mode="distance" /> })
    const bottomPanel = () => [...container.querySelectorAll('.metric-panel')].at(-1)

    dragBrushEndTraveller(bottomPanel(), -300)
    await waitFor(() => expect(tickSeconds(tickLabels(bottomPanel()).at(-1))).toBeLessThan(40))

    fireEvent.click(screen.getByText('switch-x-distance'))

    // A stale numeric zoomDomain left over from time mode (e.g. [0, 20])
    // would misread as a distance domain and clip the distance axis to
    // 0–20m instead of the full 0–200m track — resetting on mode switch
    // avoids that silent bug.
    await waitFor(() =>
      expect(tickLabels(bottomPanel())).toEqual(['0m', '50m', '100m', '150m', '200m']),
    )
    await waitFor(() => expect(linePointCount(bottomPanel())).toBe(5))
  })
})
