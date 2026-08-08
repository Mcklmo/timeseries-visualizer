// The derivative overlay against real recordings rather than hand-built ramps.
// derivative.test.js pins the arithmetic; this pins that the arithmetic
// produces numbers a runner would recognise, on the two fixtures that bracket
// the range this app supports: a 1 Hz watch export and a 72-hour breadcrumb
// track. A unit test cannot catch a scale factor that is wrong by 60.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { derivativeSeries } from './derivative.js'
import { gapThresholdFor } from './samplingInterval.js'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { FitActivitySource } from '../data/fit/FitActivitySource.js'
import { GpxActivitySource } from '../data/gpx/GpxActivitySource.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')

function loadFit() {
  const bytes = readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit'))
  const file = new File([bytes], '23870166877_ACTIVITY.fit', { type: 'application/vnd.ant.fit' })
  return new FitActivitySource().load({ type: 'file', file })
}

/** The overlay's own pipeline: accessor -> derivative -> display units. */
function displaySeries(activity, metricId, kind) {
  const spec = metricRegistry[metricId].derivative[kind]
  const t = activity.samples.map((s) => s.t)
  const values = activity.samples.map((s) => metricRegistry[metricId].accessor(s))
  return derivativeSeries(values, t, {
    order: kind === 'd2' ? 2 : 1,
    intervalS: activity.samplingIntervalS,
    gapThresholdS: gapThresholdFor(activity.samplingIntervalS),
  }).map((v) => (v == null ? null : v * spec.perSecondScale))
}

const finite = (series) => series.filter((v) => v != null && Number.isFinite(v))
const quantileOfAbs = (series, p) => {
  const sorted = finite(series).map(Math.abs).sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * p)]
}

describe('real Garmin export (fixtures/23870166877_ACTIVITY.fit, 1801 samples @ 1 Hz)', () => {
  it('reads heart-rate ramp in single- and double-digit bpm/min for the bulk of the run', async () => {
    const activity = await loadFit()
    const d1 = displaySeries(activity, 'heartRate', 'd1')

    expect(d1).toHaveLength(activity.samples.length)
    // Half the run is inside ±20 bpm/min and 90% inside ±40 — a runner's own
    // sense of "my heart rate is climbing" in numbers, not hundreds.
    expect(quantileOfAbs(d1, 0.5)).toBeLessThan(20)
    expect(quantileOfAbs(d1, 0.9)).toBeLessThan(40)
  })

  it('keeps its genuine peak — the start-of-run surge — well outside that bulk', async () => {
    // HR climbs 77 -> 108 bpm over eight seconds at t≈48-56s. That is real, and
    // it is why MetricPanel scales the axis to a quantile rather than the max:
    // one true burst an order of magnitude above p90 would otherwise flatten
    // the rest of the trace onto the centre line.
    const activity = await loadFit()
    const d1 = displaySeries(activity, 'heartRate', 'd1')
    expect(Math.max(...finite(d1))).toBeGreaterThan(5 * quantileOfAbs(d1, 0.9))
  })

  it('crosses zero, since the crossing is the landmark the overlay exists to show', async () => {
    const activity = await loadFit()
    for (const kind of ['d1', 'd2']) {
      const series = finite(displaySeries(activity, 'heartRate', kind))
      expect(Math.min(...series)).toBeLessThan(0)
      expect(Math.max(...series)).toBeGreaterThan(0)
    }
  })

  it('reads climb rate in m/min and power ramp in W/s, each in its own scale', async () => {
    const activity = await loadFit()
    // A trail run's climb rate lives in tens of m/min, not tenths (m/s) or
    // thousands — this is the assertion that catches a ×60 in the wrong place.
    expect(quantileOfAbs(displaySeries(activity, 'altitude', 'd1'), 0.9)).toBeGreaterThan(0.5)
    expect(quantileOfAbs(displaySeries(activity, 'altitude', 'd1'), 0.9)).toBeLessThan(60)
    // Power is left in W/s, where a surge is single- to double-digit.
    expect(quantileOfAbs(displaySeries(activity, 'power', 'd1'), 0.9)).toBeLessThan(30)
  })
})

describe('sparse multi-day GPX (fixtures/sparse-multiday.gpx, 45 breadcrumbs over 72h)', () => {
  it('nulls the climb rate across every dropout instead of averaging through it', async () => {
    const bytes = readFileSync(join(FIXTURE_DIR, 'sparse-multiday.gpx'))
    const file = new File([bytes], 'sparse-multiday.gpx', { type: 'application/gpx+xml' })
    const activity = await new GpxActivitySource().load({ type: 'file', file })
    const d1 = displaySeries(activity, 'altitude', 'd1')

    // The line must break, not draw a flat rate through a six-hour outage...
    expect(d1.some((v) => v == null)).toBe(true)
    // ...and must still say something everywhere else.
    expect(finite(d1).length).toBeGreaterThan(d1.length / 2)
    // At this cadence the smoothing window collapses to one sample, so these
    // are raw centred differences — and still a plausible walking climb rate.
    expect(quantileOfAbs(d1, 1)).toBeLessThan(50)
  })
})
