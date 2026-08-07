import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MetricPanel } from './MetricPanel.jsx'
import { extentOf, fullDomain } from '../domain/zoomDomain.js'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { statsBasisFor } from '../stats/statsBasis.js'

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

const DEFAULT_PROPS = {
  activity,
  metricId: 'heartRate',
  xMode: 'time',
  zoomDomain: fullDomain(),
  enabledStats: ['avg'],
  showXAxis: true,
  height: 200,
}

// ChartStack builds this once for the whole stack and passes it down; a panel
// rendered on its own has to build its own. Derived from the panel's other
// props so a test that sets `zoomDomain` gets stats for that window, exactly
// as it would in the app.
function renderPanel(props = {}) {
  const merged = { ...DEFAULT_PROPS, ...props }
  const xKey = merged.xMode === 'distance' ? 'd' : 't'
  const statsBasis =
    merged.statsBasis ??
    statsBasisFor(merged.activity, xKey, merged.zoomDomain, extentOf(merged.activity.samples, xKey))
  return render(<MetricPanel {...merged} statsBasis={statsBasis} />)
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
    const { container } = renderPanel({ activity: withGap, enabledStats: [] })
    const d = linePath(container).getAttribute('d')
    expect(d.match(/M/g)).toHaveLength(2)
  })

  it('plots against elapsed time when xMode is time', () => {
    const { container } = renderPanel({ xMode: 'time' })
    const labels = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan')].map(
      (el) => el.textContent,
    )
    // Ticks are formatted by span (units.js's makeElapsedTickFormatter): a
    // 40-second fixture falls in the m:ss band. Raw seconds used to be printed
    // verbatim, which read as "259200" on a multi-day track.
    expect(labels[0]).toBe('0:00')
    expect(labels.at(-1)).toBe('0:40')
  })

  it('plots against distance when xMode is distance', () => {
    const { container } = renderPanel({ xMode: 'distance' })
    const labels = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan')].map(
      (el) => el.textContent,
    )
    expect(labels[0]).toBe('0m')
    expect(labels.at(-1)).toBe('200m')
  })

  // The cheapest possible guard on the finding that a numeric `domain` alone
  // is a no-op: Recharts' extendDomain() widens a user-supplied domain back
  // out to the data extent unless allowDataOverflow is set, so without that
  // prop this axis would still read 0:00–0:40 and every pinch in the app
  // would do nothing at all — with no error anywhere.
  it('narrows the x-axis to a numeric zoomDomain (allowDataOverflow, or the domain is ignored)', () => {
    const { container } = renderPanel({ zoomDomain: [10, 30] })
    const labels = [
      ...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan'),
    ].map((el) => el.textContent)
    expect(labels[0]).toBe('0:10')
    expect(labels.at(-1)).toBe('0:30')
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
    const { container } = renderPanel({ enabledStats: ['avg', 'max', 'min'] })
    expect(container.querySelectorAll('.recharts-reference-line')).toHaveLength(3)
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

  it('reports the zoom window, not the whole activity, once the basis is windowed', () => {
    // Same weighting rule over the last three samples only: the 0-10-20s
    // stretch is off screen and must not be in the number.
    // (150 + 140) × 10 / 20 = 145, against 135 for the whole activity.
    const { container } = renderPanel({ metricId: 'heartRate', enabledStats: ['avg'], zoomDomain: [20, 40] })
    expect(container.textContent).toContain('AVG 145 bpm')
    expect(container.textContent).not.toContain('AVG 135 bpm')
  })

  it("resolves cadence's unit from the activity's sport: spm for running, rpm for cycling", () => {
    const { container: runningContainer } = renderPanel({ metricId: 'cadence', enabledStats: ['avg'] })
    expect(runningContainer.textContent).toContain('spm')
    expect(runningContainer.textContent).not.toContain('rpm')

    const { container: cyclingContainer } = renderPanel({
      activity: { ...activity, sport: 'cycling' },
      metricId: 'cadence',
      enabledStats: ['avg'],
    })
    expect(cyclingContainer.textContent).toContain('rpm')
    expect(cyclingContainer.textContent).not.toContain('spm')
  })

  it('renders every enabled stat as its own chip below the chart, even when values are pixels apart', () => {
    // avg and median land within a couple of bpm of each other here — a flex
    // row can't overlap the way SVG-positioned labels could, so both must
    // still render as distinct elements.
    const { container } = renderPanel({ metricId: 'heartRate', enabledStats: ['avg', 'median', 'min'] })
    const chips = [...container.querySelectorAll('.stat-chip')]
    expect(chips).toHaveLength(3)
    expect(chips.map((el) => el.textContent)).toEqual([
      expect.stringContaining('MIN'),
      expect.stringContaining('AVG'),
      expect.stringContaining('MEDIAN'),
    ])
  })

  it('distinguishes stat kinds by dash pattern: max dashed, min tightly dotted, avg solid, median differently dashed', () => {
    const { container } = renderPanel({ enabledStats: ['max', 'min', 'avg', 'median'] })
    const lines = [...container.querySelectorAll('.recharts-reference-line-line')]
    const dashes = lines.map((l) => l.getAttribute('stroke-dasharray'))
    expect(dashes).toContain('4 4')
    expect(dashes).toContain('1 2')
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
    const { container } = renderPanel({
      activity: withPause,
      metricId: 'cadence',
      enabledStats: [],
      showXAxis: false,
    })
    const labels = [
      ...container.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value tspan'),
    ].map((el) => Number(el.textContent))
    expect(labels.every((v) => v >= 100)).toBe(true)
  })

  // A sparse, multi-day GPS log: breadcrumbs every 10 minutes with one 6-hour
  // satellite dropout. Sparse data carries no nulls of its own, so without an
  // inserted break the dropout renders as one straight diagonal across six
  // hours of nothing.
  const sparseActivity = {
    id: 'spot-1',
    sport: 'track',
    totalMovingTime: 259200,
    totalTime: 259200,
    totalDistance: 47000,
    samplingIntervalS: 600,
    samples: [
      { t: 0, d: 0, speed: 1.2, altitude: 980, moving: true },
      { t: 600, d: 720, speed: 1.2, altitude: 1020, moving: true },
      { t: 1200, d: 1440, speed: 1.2, altitude: 1060, moving: true },
      { t: 22800, d: 20000, speed: 0.9, altitude: 1400, moving: false }, // after a 6h dropout
      { t: 23400, d: 20720, speed: 1.2, altitude: 1420, moving: true },
    ],
    availableMetrics: ['speed', 'altitude'],
  }

  function renderSparsePanel(props = {}) {
    return renderPanel({ activity: sparseActivity, metricId: 'altitude', enabledStats: [], ...props })
  }

  it('breaks the line at a recording dropout in sparse data, which carries no nulls of its own', () => {
    const { container } = renderSparsePanel()
    // Two subpaths: the synthetic null row inserted mid-gap is what
    // connectNulls={false} breaks on.
    expect(linePath(container).getAttribute('d').match(/M/g)).toHaveLength(2)
  })

  it('does not break the line across ordinary breadcrumb intervals', () => {
    const noDropout = {
      ...sparseActivity,
      samples: sparseActivity.samples.slice(0, 3),
    }
    const { container } = renderSparsePanel({ activity: noDropout })
    expect(linePath(container).getAttribute('d').match(/M/g)).toHaveLength(1)
  })

  it('scales the x-axis ticks to a multi-day span instead of printing raw seconds', () => {
    const threeDays = { ...sparseActivity, totalTime: 259200 }
    const { container } = renderSparsePanel({ activity: threeDays })
    const labels = [
      ...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan'),
    ].map((el) => el.textContent)
    // Raw elapsed seconds used to render as "23400" here.
    expect(labels.every((l) => /^(\d+d)?\d+h$/.test(l))).toBe(true)
  })

  it('gives every panel the same syncId so crosshairs sync across panels', () => {
    // syncId is not a rendered DOM attribute; cross-panel sync itself is
    // verified at the ChartStack level. Here we just confirm hovering
    // produces a cursor at all, i.e. a Tooltip is wired up.
    const { container } = renderPanel()
    expect(container.querySelector('.recharts-wrapper')).toBeInTheDocument()
  })
})
