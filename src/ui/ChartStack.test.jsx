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

  it('gives the first panel more height than the rest', async () => {
    const { container } = await renderStack()
    const panels = [...container.querySelectorAll('.metric-panel')]
    const heights = panels.map((p) => p.style.height)
    expect(heights[0]).toBe('200px')
    expect(heights.slice(1)).toEqual(['140px', '140px', '140px'])
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
})
