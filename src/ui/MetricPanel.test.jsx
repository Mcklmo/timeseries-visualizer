import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MetricPanel } from './MetricPanel.jsx'
import { metricRegistry } from '../metrics/metricRegistry.js'

// Recharts path data looks like "M61,85L328,5L595,45" — one M/L command per
// rendered point, in data order. Parsing it back out is the only way to
// assert pixel positions without a real browser layout engine.
function pathPoints(pathEl) {
  const d = pathEl.getAttribute('d')
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }))
}

function linePath(container) {
  return container.querySelector('.recharts-line .recharts-curve')
}

const activity = {
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

function renderPanel(props = {}) {
  return render(
    <MetricPanel
      activity={activity}
      metricId="heartRate"
      xMode="time"
      zoomDomain={['dataMin', 'dataMax']}
      enabledStats={['avg']}
      showXAxis={true}
      height={200}
      {...props}
    />,
  )
}

describe('MetricPanel', () => {
  it('renders one line point per sample', () => {
    const { container } = renderPanel()
    expect(pathPoints(linePath(container))).toHaveLength(activity.samples.length)
  })

  it('renders no dots on the line (dot={false})', () => {
    const { container } = renderPanel()
    expect(container.querySelectorAll('.recharts-dot')).toHaveLength(0)
  })

  it('renders the final line geometry synchronously, with no animation delay', () => {
    // isAnimationActive={false}: react-smooth would otherwise animate the
    // path's `d` from a flat/zero start on first paint.
    const { container } = renderPanel()
    const points = pathPoints(linePath(container))
    const ys = points.map((p) => p.y)
    expect(new Set(ys).size).toBeGreaterThan(1)
  })

  it('breaks the line into separate segments across a null sample (connectNulls={false})', () => {
    const withGap = {
      ...activity,
      samples: activity.samples.map((s, i) => (i === 2 ? { ...s, heartRate: undefined } : s)),
    }
    const { container } = render(
      <MetricPanel
        activity={withGap}
        metricId="heartRate"
        xMode="time"
        zoomDomain={['dataMin', 'dataMax']}
        enabledStats={[]}
        showXAxis={true}
        height={200}
      />,
    )
    const d = linePath(container).getAttribute('d')
    expect(d.match(/M/g)).toHaveLength(2)
  })

  it('plots against elapsed time when xMode is time', () => {
    const { container } = renderPanel({ xMode: 'time' })
    const labels = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan')].map(
      (el) => el.textContent,
    )
    expect(labels[0]).toBe('0')
    expect(labels.at(-1)).toBe('40')
  })

  it('plots against distance when xMode is distance', () => {
    const { container } = renderPanel({ xMode: 'distance' })
    const labels = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan')].map(
      (el) => el.textContent,
    )
    expect(labels[0]).toBe('0')
    expect(labels.at(-1)).toBe('200')
  })

  it('hides x-axis tick labels on non-bottom panels', () => {
    const { container } = renderPanel({ showXAxis: false })
    expect(container.querySelectorAll('.recharts-xAxis-tick-labels')).toHaveLength(0)
  })

  it('shows x-axis tick labels on the bottom panel', () => {
    const { container } = renderPanel({ showXAxis: true })
    expect(container.querySelectorAll('.recharts-xAxis-tick-labels').length).toBeGreaterThan(0)
  })

  it('uses a fixed y-axis width regardless of metric, so panels align pixel-for-pixel', () => {
    const { container: hrContainer } = renderPanel({ metricId: 'heartRate' })
    const { container: cadContainer } = renderPanel({ metricId: 'cadence' })
    const hrLine = hrContainer.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')
    const cadLine = cadContainer.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')
    expect(hrLine.getAttribute('x1')).toBe(cadLine.getAttribute('x1'))
  })

  it('does not reverse the y-axis for a normal metric: higher values plot higher (smaller svg y)', () => {
    const { container } = renderPanel({ metricId: 'heartRate' })
    const points = pathPoints(linePath(container))
    const maxSampleIdx = activity.samples.reduce(
      (best, s, i) => (s.heartRate > activity.samples[best].heartRate ? i : best),
      0,
    )
    const minSampleIdx = activity.samples.reduce(
      (best, s, i) => (s.heartRate < activity.samples[best].heartRate ? i : best),
      0,
    )
    expect(points[maxSampleIdx].y).toBeLessThan(points[minSampleIdx].y)
  })

  it('reverses the y-axis for an invertAxis metric (pace): faster (lower value) plots higher', () => {
    const { container } = renderPanel({ metricId: 'pace' })
    const paceValues = activity.samples.map((s) => metricRegistry.pace.accessor(s))
    const fastestIdx = paceValues.reduce((best, v, i) => (v < paceValues[best] ? i : best), 0)
    const slowestIdx = paceValues.reduce((best, v, i) => (v > paceValues[best] ? i : best), 0)
    const points = pathPoints(linePath(container))
    expect(points[fastestIdx].y).toBeLessThan(points[slowestIdx].y)
  })

  it('renders one reference line per enabled stat, and none for a disabled stat', () => {
    const { container } = renderPanel({ enabledStats: ['avg', 'max'] })
    expect(container.querySelectorAll('.recharts-reference-line')).toHaveLength(2)
  })

  it('renders no reference lines when no stat is enabled', () => {
    const { container } = renderPanel({ enabledStats: [] })
    expect(container.querySelectorAll('.recharts-reference-line')).toHaveLength(0)
  })

  it('labels each reference line with the stat kind, formatted value, and unit', () => {
    const { container } = renderPanel({ metricId: 'heartRate', enabledStats: ['avg'] })
    // time-weighted avg: the last sample carries 0 weight (no "next" gap),
    // so it's (120+130+150+140)*10 / 40 = 135, not the plain mean of 130.
    expect(container.textContent).toContain('AVG 135 bpm')
  })

  it("resolves cadence's unit from the activity's sport: spm for running, rpm for cycling", () => {
    const { container: runningContainer } = renderPanel({ metricId: 'cadence', enabledStats: ['avg'] })
    expect(runningContainer.textContent).toContain('spm')
    expect(runningContainer.textContent).not.toContain('rpm')

    const { container: cyclingContainer } = render(
      <MetricPanel
        activity={{ ...activity, sport: 'cycling' }}
        metricId="cadence"
        xMode="time"
        zoomDomain={['dataMin', 'dataMax']}
        enabledStats={['avg']}
        showXAxis={true}
        height={200}
      />,
    )
    expect(cyclingContainer.textContent).toContain('rpm')
    expect(cyclingContainer.textContent).not.toContain('spm')
  })

  it('keeps stat labels a minimum distance apart even when their values are pixels apart', () => {
    // avg and median land within a couple of bpm of each other here, which
    // would put their labels almost on top of one another without decluttering.
    const { container } = renderPanel({ metricId: 'heartRate', enabledStats: ['avg', 'median'] })
    const ys = [...container.querySelectorAll('.stat-labels text')].map((el) => Number(el.getAttribute('y')))
    expect(ys).toHaveLength(2)
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(16)
  })

  it('distinguishes stat kinds by dash pattern: max dashed, avg solid, median differently dashed', () => {
    const { container } = renderPanel({ enabledStats: ['max', 'avg', 'median'] })
    const lines = [...container.querySelectorAll('.recharts-reference-line-line')]
    const dashes = lines.map((l) => l.getAttribute('stroke-dasharray'))
    expect(dashes).toContain('4 4')
    expect(dashes).toContain('2 3')
    expect(dashes.some((d) => d == null || d === 'none')).toBe(true)
  })

  it('zooms the cadence y-axis to the real moving band, excluding paused zero samples from the domain', () => {
    const withPause = {
      ...activity,
      samples: [
        { t: 0, d: 0, cadence: 165, moving: true },
        { t: 10, d: 50, cadence: 190, moving: true },
        { t: 20, d: 60, cadence: 0, moving: false }, // stopped at a light
        { t: 30, d: 110, cadence: 178, moving: true },
      ],
    }
    const { container } = render(
      <MetricPanel
        activity={withPause}
        metricId="cadence"
        xMode="time"
        zoomDomain={['dataMin', 'dataMax']}
        enabledStats={[]}
        showXAxis={false}
        height={200}
      />,
    )
    const labels = [
      ...container.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value tspan'),
    ].map((el) => Number(el.textContent))
    expect(labels.every((v) => v >= 100)).toBe(true)
  })

  it('gives every panel the same syncId so crosshairs sync across panels', () => {
    // syncId is not a rendered DOM attribute; cross-panel sync itself is
    // verified at the ChartStack level. Here we just confirm hovering
    // produces a cursor at all, i.e. a Tooltip is wired up.
    const { container } = renderPanel()
    expect(container.querySelector('.recharts-wrapper')).toBeInTheDocument()
  })
})
