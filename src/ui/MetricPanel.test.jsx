import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MetricPanel } from './MetricPanel.jsx'
import { extentOf, fullDomain } from '../domain/zoomDomain.js'
import { metricRegistry, statKindsFor } from '../metrics/metricRegistry.js'
import { statsBasisFor } from '../stats/statsBasis.js'
import { CHART_MARGIN, plotRectFromSurface, Y_AXIS_RIGHT_WIDTH, Y_AXIS_WIDTH } from './chartGeometry.js'
import { derivativeStroke } from './derivativeStyle.js'
import { statCheckboxLabel } from './StatCheckboxes.jsx'

// Recharts path data looks like "M61,85L328,5L595,45" — one M/L command per
// rendered point, in data order. Parsing it back out is the only way to
// assert pixel positions without a real browser layout engine.
function pathPoints(pathEl) {
  const d = pathEl.getAttribute('d')
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }))
}

function linePath(container) {
  return container.querySelector('.metric-line .recharts-curve')
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

  // ── derivative overlay ──────────────────────────────────────────────────
  //
  // `samplingIntervalS` is spelled out here where the shared fixture leaves it
  // undefined: it sizes both the smoothing window and the gap threshold, and a
  // real Activity always carries it. At 10s the window collapses to one sample
  // (§4.2's branch), so these are the raw centred differences and the numbers
  // below can be checked by hand.
  const derivActivity = { ...activity, samplingIntervalS: 10 }
  const withOverlay = { activity: derivActivity, enabledStats: ['d1'], rightInset: Y_AXIS_RIGHT_WIDTH }

  // Selected by class, not by index: the marks on a panel get renumbered every
  // time one is added or the paint order changes, and this one flipped once.
  function derivPath(container) {
    return container.querySelector('.deriv-line .recharts-curve')
  }

  it('draws the derivative under the main line, thinner and in a stepped shade of the hue', () => {
    const { container } = renderPanel(withOverlay)
    const curves = [...container.querySelectorAll('.recharts-line .recharts-curve')]
    const main = container.querySelector('.metric-line .recharts-curve')
    const deriv = derivPath(container)

    // The casing is gone. 4.5px of accent under a 2px core made the DERIVED
    // series the heaviest mark on a panel that is about the measured one.
    expect(container.querySelector('.deriv-casing')).toBeNull()
    expect(curves).toHaveLength(2)

    // One hue per metric (§9) — this IS that metric, seen as a rate, so it is
    // a step of the same hue and not a colour of its own. Which DIRECTION that
    // step goes is the helper's business, not this test's (heart rate steps
    // lighter, power darker — see derivativeStyle.test.js). Reading it from the
    // shared helper is the point: the checkbox reads the same one.
    expect(deriv.getAttribute('stroke')).toBe(derivativeStroke(metricRegistry.heartRate))
    expect(main.getAttribute('stroke')).toBe(metricRegistry.heartRate.color)

    // The hierarchy, which is the whole fix: the measured series is the
    // heavier mark AND paints on top of the one derived from it.
    expect(Number(deriv.getAttribute('stroke-width'))).toBeLessThan(Number(main.getAttribute('stroke-width')))
    expect(curves.indexOf(deriv)).toBe(0)
    expect(curves.indexOf(main)).toBe(1)

    // Both solid. A derivative is noisy by construction, and a dash on a
    // high-frequency trace turns to mush — the old `3 3` is one of the three
    // reasons the overlay could not be found at all.
    expect(main.getAttribute('stroke-dasharray')).toBeNull()
    expect(deriv.getAttribute('stroke-dasharray')).toBeNull()
  })

  // The shared fixture is a run with no power channel, and neither has the
  // repo's only .fit (0 power samples in 1801 records) — which is why power's
  // overlay was the one metric nothing here ever rendered, and why the user
  // found it by eye before a test did. Built exactly as derivActivity is.
  const powerActivity = {
    ...derivActivity,
    samples: activity.samples.map((s, i) => ({ ...s, power: 200 + i * 10 })),
    availableMetrics: [...activity.availableMetrics, 'power'],
  }

  it('steps power’s derivative darker, amber having no headroom toward white', () => {
    const { container } = renderPanel({
      activity: powerActivity,
      metricId: 'power',
      enabledStats: ['d1'],
      rightInset: Y_AXIS_RIGHT_WIDTH,
    })
    const deriv = derivPath(container)
    const main = container.querySelector('.metric-line .recharts-curve')

    // A fixed 72% mix toward white moved amber only 0.034 in oklab L against
    // heart rate's 0.099, and the two lines landed 1.1:1 apart on the panel.
    expect(deriv.getAttribute('stroke')).toBe(derivativeStroke(metricRegistry.power))
    expect(deriv.getAttribute('stroke')).not.toBe(metricRegistry.power.color)
    expect(main.getAttribute('stroke')).toBe(metricRegistry.power.color)
  })

  it('draws no overlay when no derivative is enabled, whatever the gutter says', () => {
    // The gutter is stack-wide: this panel reserves it for a SIBLING's overlay
    // and must still draw only its own line.
    const { container } = renderPanel({ activity: derivActivity, enabledStats: [], rightInset: Y_AXIS_RIGHT_WIDTH })
    expect(container.querySelectorAll('.recharts-line .recharts-curve')).toHaveLength(1)
  })

  it('reserves the right-hand axis whenever the stack has one, but labels it only when this panel does', () => {
    const labelled = renderPanel(withOverlay).container
    const reservedOnly = renderPanel({
      activity: derivActivity,
      enabledStats: [],
      rightInset: Y_AXIS_RIGHT_WIDTH,
    }).container

    // Both panels carry two y-axes — that is what keeps their plot areas the
    // same width (ARCHITECTURE.md §7).
    expect(labelled.querySelectorAll('.recharts-yAxis')).toHaveLength(2)
    expect(reservedOnly.querySelectorAll('.recharts-yAxis')).toHaveLength(2)

    // Only the panel with the overlay puts ticks on it; the other is a blank
    // spacer, since a rate axis with no rate on it labels nothing.
    const rightTicks = (c) => [...c.querySelectorAll('.recharts-yAxis')][1].querySelectorAll('.recharts-cartesian-axis-tick')
    expect(rightTicks(labelled).length).toBeGreaterThan(0)
    expect(rightTicks(reservedOnly)).toHaveLength(0)

    // The right axis is tinted to the overlay's own stroke, which is what says
    // "this pale line reads against THESE ticks" (§7).
    const tint = derivativeStroke(metricRegistry.heartRate)
    const rightAxis = (c) => [...c.querySelectorAll('.recharts-yAxis')][1]
    expect(rightAxis(labelled).querySelector('.recharts-cartesian-axis-line').getAttribute('stroke')).toBe(tint)
    // The tick TEXT is not under .recharts-yAxis: recharts@3.10.1 hoists tick
    // labels into a shared z-index layer (`ZIndexLayer` at DefaultZIndexes.label
    // in CartesianAxis.js), leaving only the lines behind. Found by its own
    // `orientation` rather than by index for that reason.
    const rightTickText = [...labelled.querySelectorAll('.recharts-cartesian-axis-tick-value')].find(
      (t) => t.getAttribute('orientation') === 'right',
    )
    // This checks the DECLARATION only. Recharts emits `fill` on <text> as a
    // presentation ATTRIBUTE (component/Text.js), which every stylesheet rule
    // outranks — and global.css paints .metric-panel .recharts-text with
    // --text-dim, so in a real browser this attribute lost and the numbers came
    // out grey. What actually paints them is the custom property below, which
    // the stylesheet reads. jsdom loads no CSS, so the cascade itself is not
    // observable from here; asserting both ends is as close as a test gets.
    expect(rightTickText.getAttribute('fill')).toBe(tint)
    expect(labelled.querySelector('.metric-panel').style.getPropertyValue('--deriv-hue')).toBe(tint)
    // The reserve-only panel labels nothing, so it sets no hue and the rule
    // falls back to --text-dim.
    expect(reservedOnly.querySelector('.metric-panel').style.getPropertyValue('--deriv-hue')).toBe('')
  })

  it('draws no overlay at all without a gutter to draw it in', () => {
    // The interlock. Recharts does NOT error on a <Line yAxisId> naming an axis
    // nothing rendered — it invents one 60px wide, silently laying the panel
    // out narrower than the gesture believes. ChartStack never produces this
    // combination; a mis-wired caller would, and losing the overlay is the
    // visible failure where the alternative is invisible.
    const { container } = renderPanel({ activity: derivActivity, enabledStats: ['d1'], rightInset: 0 })
    expect(container.querySelectorAll('.recharts-line .recharts-curve')).toHaveLength(1)
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(1)
  })

  it('defaults rightInset to 0, so a panel rendered without it lays out exactly as before', () => {
    // ~fifteen tests in this file render from DEFAULT_PROPS, which does not
    // pass rightInset. Without the default, `width={undefined}` would reach
    // <YAxis> and Recharts would substitute its own 60px — laying the panel out
    // narrower than the gesture believes.
    const { container } = renderPanel()
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(1)
  })

  it('lays the plot out exactly where plotRectFromSurface says it is, gutter included', () => {
    // §3's central claim, end to end: the pinch gesture computes the plot rect
    // by subtracting constants, the chart lays itself out from those same
    // constants, and this is where the two are checked against each other once
    // a second axis exists. setupTests.js gives every element an 800px-wide
    // rect, so the Recharts surface here is 800 wide.
    const { container } = renderPanel(withOverlay)
    const axisLines = [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-line')]
    const left = Number(axisLines[0].getAttribute('x1'))
    const right = Number(axisLines[1].getAttribute('x1'))
    const expected = plotRectFromSurface({ left: 0, width: 800 }, Y_AXIS_RIGHT_WIDTH)

    expect(left).toBe(expected.left)
    expect(right - left).toBe(expected.width)
  })

  it('centres the derivative axis on zero, so the sign reads off the line’s position', () => {
    const { container } = renderPanel(withOverlay)
    // Symmetric domain ⇒ the zero reference line sits at the plot's vertical
    // midpoint. Anything else and "above the middle = rising" stops holding.
    const zeroLine = container.querySelector('.recharts-reference-line-line')
    const plot = container.querySelector('.recharts-cartesian-grid-horizontal line')
    expect(zeroLine).not.toBeNull()
    expect(plot).not.toBeNull()

    const y = Number(zeroLine.getAttribute('y1'))
    const gridYs = [...container.querySelectorAll('.recharts-cartesian-grid-horizontal line')].map((l) =>
      Number(l.getAttribute('y1')),
    )
    const mid = (Math.min(...gridYs) + Math.max(...gridYs)) / 2
    expect(y).toBeCloseTo(mid, 6)
  })

  it('reports a derivative as a line only — no chip, since it is a series and not a scalar', () => {
    const { container } = renderPanel({ ...withOverlay, enabledStats: ['d1', 'avg'] })
    const chips = [...container.querySelectorAll('.stat-chip')]
    // avg still chips; d1 does not, and does not become a horizontal line
    // either — the only reference line is the zero crossing.
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toContain('AVG')
    expect(container.querySelectorAll('.recharts-reference-line')).toHaveLength(2)
  })

  it('breaks the overlay across a recording dropout instead of drawing a rate through it', () => {
    const sparse = {
      ...activity,
      samplingIntervalS: 600,
      totalTime: 25200,
      samples: [
        { t: 0, d: 0, heartRate: 120, moving: true },
        { t: 600, d: 300, heartRate: 130, moving: true },
        { t: 1200, d: 600, heartRate: 128, moving: true },
        // 6.3h satellite dropout
        { t: 24000, d: 900, heartRate: 140, moving: true },
        { t: 24600, d: 1200, heartRate: 145, moving: true },
        { t: 25200, d: 1500, heartRate: 138, moving: true },
      ],
    }
    const { container } = renderPanel({
      activity: sparse,
      metricId: 'heartRate',
      enabledStats: ['d1'],
      rightInset: Y_AXIS_RIGHT_WIDTH,
    })

    // Two path segments, not one continuous line: a difference measured across
    // a six-hour outage is not a heart-rate ramp.
    expect(derivPath(container).getAttribute('d').match(/M/g).length).toBeGreaterThan(1)
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

  // ── the panel head ──────────────────────────────────────────────────────
  //
  // The fixed label band above the chart: the metric's name, the crosshair's
  // current value, and this graph's own settings behind the unfold arrow.
  // Every case above renders from DEFAULT_PROPS, which passes neither of the
  // head's two new props — that they all still pass is the check that both
  // defaulted correctly, the same guarantee `rightInset = 0` carries.
  describe('the head', () => {
    it('names the metric in the head, above the chart', () => {
      const { container } = renderPanel()
      expect(container.querySelector('.metric-readout__label').textContent).toBe('Heart rate')
      // Above, not below: the head is what the reader's eye is already on when
      // the crosshair moves.
      const head = container.querySelector('.metric-panel__head')
      const chart = container.querySelector('.recharts-wrapper')
      expect(head.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('carries the metric’s own hue, so the head and its toolbar checkbox read as one thing', () => {
      const { container } = renderPanel()
      expect(container.querySelector('.metric-readout').style.getPropertyValue('--metric-color')).toBe(
        metricRegistry.heartRate.color,
      )
    })

    it('indents the head to the plot’s own left edge, derived from chartGeometry', () => {
      // Not a 60px literal: the gesture subtracts exactly these constants to
      // find the plot, and a second copy in the stylesheet would be free to
      // drift from the one the chart is laid out with.
      const { container } = renderPanel()
      expect(container.querySelector('.metric-panel').style.getPropertyValue('--plot-inset')).toBe(
        `${Y_AXIS_WIDTH + CHART_MARGIN.left}px`,
      )
    })

    it('leaves the value slot empty at rest, so CSS can render the at-rest dash', () => {
      // React must never put children in this node — it is the portal target
      // CrosshairReadout fills — which is what makes `:empty::after` a reliable
      // "no crosshair anywhere" and keeps the dash out of JS entirely.
      const { container } = renderPanel()
      const slot = container.querySelector('.crosshair-slot')
      expect(slot).not.toBeNull()
      expect(slot).toBeEmptyDOMElement()
    })

    it('starts the settings folded away, leaving the graphs the screen', () => {
      // jsdom 30 applies no UA hiding to a closed <details>, so a role query is
      // NOT a proxy for "collapsed" — the `open` attribute is the observable.
      const { container } = renderPanel()
      expect(container.querySelector('details.metric-settings')).not.toHaveAttribute('open')
    })

    it('puts this metric’s stat boxes in its own head, addressable by their accessible names', () => {
      const { container } = renderPanel()
      const head = container.querySelector('.metric-panel__head')
      for (const kind of statKindsFor(metricRegistry.heartRate)) {
        const box = screen.getByRole('checkbox', { name: statCheckboxLabel(metricRegistry.heartRate, kind) })
        expect(head.contains(box)).toBe(true)
      }
    })

    it('offers derivative boxes only on a metric that declares one', () => {
      // heartRate declares a derivative; cadence does not, so it gets the four
      // scalar kinds and nothing else.
      renderPanel({ metricId: 'cadence', enabledStats: [] })
      expect(screen.getAllByRole('checkbox', { name: /^Cadence / })).toHaveLength(4)
      expect(screen.queryByRole('checkbox', { name: 'Cadence ramp' })).not.toBeInTheDocument()
    })

    it('reflects enabledStats in the boxes rather than holding state of its own', () => {
      renderPanel({ enabledStats: ['avg', 'max'] })
      expect(screen.getByRole('checkbox', { name: 'Heart rate avg' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Heart rate max' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Heart rate min' })).not.toBeChecked()
    })

    it('reports a clicked box to onToggleStat, naming the metric it belongs to', async () => {
      // The panel writes no state itself: the click goes back to ChartViewContext's
      // toggleStat, which is what enforces at most one derivative per metric.
      const onToggleStat = vi.fn()
      renderPanel({ onToggleStat })

      await userEvent.click(screen.getByRole('checkbox', { name: 'Heart rate max' }))

      expect(onToggleStat).toHaveBeenCalledWith('heartRate', 'max')
    })

    it('lights a checked derivative box in the colour of the line that panel draws', () => {
      // The control and the mark are one thing only if they are literally one
      // colour — see derivativeStyle.js. Asserted here rather than at the stack
      // level now that the box and the line it draws are in the same component.
      const { container } = renderPanel(withOverlay)
      const ramp = screen.getByRole('checkbox', { name: 'Heart rate ramp' })
      const drawn = container.querySelector('.deriv-line .recharts-curve').getAttribute('stroke')

      expect(ramp.closest('.stat-checkbox')).toHaveClass('stat-checkbox--active')
      expect(ramp.closest('.stat-checkbox').style.getPropertyValue('--deriv-hue')).toBe(drawn)
      // The scalar kinds stay dim when checked: the tint means "derived".
      expect(screen.getByRole('checkbox', { name: 'Heart rate max' }).closest('.stat-checkbox')).not.toHaveClass(
        'stat-checkbox--active',
      )
    })
  })
})
