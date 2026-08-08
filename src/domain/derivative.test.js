import { describe, it, expect } from 'vitest'
import { derivativeSeries } from './derivative.js'
import { gapThresholdFor } from './samplingInterval.js'

// 1 Hz — the watch-export cadence, where the 9-sample smoothing window is live.
const HZ1 = { intervalS: 1, gapThresholdS: gapThresholdFor(1) }
// ~10 min between breadcrumbs — the sparse-multiday.gpx cadence, where the
// window collapses to one sample and the raw differences pass through.
const BREADCRUMB = { intervalS: 600, gapThresholdS: gapThresholdFor(600) }

const seconds = (n) => Array.from({ length: n }, (_, i) => i)

describe('derivativeSeries', () => {
  // The interior is where the arithmetic is exact. Both ends fall back to a
  // one-sided difference, and the smoothing window is clipped there, so the
  // first and last few samples are approximations by construction — the tests
  // below assert on the range where no edge effect reaches.
  it('turns a linear ramp into a constant d1 and a zero d2', () => {
    const t = seconds(30)
    const values = t.map((ti) => 3 * ti)

    const d1 = derivativeSeries(values, t, { ...HZ1 })
    const d2 = derivativeSeries(values, t, { ...HZ1, order: 2 })

    // A constant is the one case with no edge effect at all: the one-sided
    // difference and the clipped window both still give exactly 3.
    for (let i = 0; i < 30; i++) expect(d1[i]).toBeCloseTo(3, 10)
    for (let i = 0; i < 30; i++) expect(d2[i]).toBeCloseTo(0, 10)
  })

  it('turns a quadratic into a linear d1 and a constant d2', () => {
    const t = seconds(30)
    const values = t.map((ti) => ti * ti) // d/dt = 2t, d²/dt² = 2

    const d1 = derivativeSeries(values, t, { ...HZ1 })
    const d2 = derivativeSeries(values, t, { ...HZ1, order: 2 })

    // A centred difference of t² is exactly 2t, and a centred mean of a
    // straight line is exact wherever the window fits — i.e. everywhere the
    // one-sided ends have not leaked in.
    for (let i = 5; i <= 24; i++) expect(d1[i]).toBeCloseTo(2 * i, 10)
    // d2 loses another window's worth at each end, having been through the
    // whole pipeline twice.
    for (let i = 10; i <= 19; i++) expect(d2[i]).toBeCloseTo(2, 10)
  })

  it('reports value-units per second, independent of the sample interval', () => {
    // Same physical ramp — 3 units per second — logged at 1 Hz and at 10 min.
    const fast = seconds(30)
    const slow = fast.map((i) => i * 600)

    const d1Fast = derivativeSeries(fast.map((ti) => 3 * ti), fast, { ...HZ1 })
    const d1Slow = derivativeSeries(slow.map((ti) => 3 * ti), slow, { ...BREADCRUMB })

    expect(d1Fast[15]).toBeCloseTo(3, 10)
    expect(d1Slow[15]).toBeCloseTo(3, 10)
  })

  it('nulls a sample whose neighbour is null or non-finite, never zeroing it', () => {
    // At breadcrumb cadence there is no smoothing pass to average the nulls
    // back out, so the raw null positions are directly observable.
    const t = [0, 600, 1200, 1800, 2400]

    expect(derivativeSeries([0, 10, null, 30, 40], t, BREADCRUMB)).toEqual([
      1 / 60,
      null, // neighbour values[2] is null
      // NOT null: a centred difference never reads values[2] itself, only the
      // pair straddling it, so the rate across the hole is still well defined.
      1 / 60,
      null, // neighbour values[2] again
      1 / 60,
    ])

    expect(derivativeSeries([0, 10, NaN, 30, 40], t, BREADCRUMB)[1]).toBeNull()
    expect(derivativeSeries([0, 10, Infinity, 30, 40], t, BREADCRUMB)[1]).toBeNull()
    expect(derivativeSeries([0, 10, undefined, 30, 40], t, BREADCRUMB)[1]).toBeNull()
  })

  it('nulls across a recording dropout rather than dividing by it', () => {
    // 10-minute breadcrumbs, then a six-hour satellite outage.
    const t = [0, 600, 1200, 22800]
    const d1 = derivativeSeries([100, 110, 120, 130], t, BREADCRUMB)

    expect(d1[0]).toBeCloseTo(1 / 60, 10)
    expect(d1[1]).toBeCloseTo(1 / 60, 10)
    // Both samples whose difference would straddle the outage: 10 metres over
    // six hours is not a climb rate, it is two unrelated altitudes.
    expect(d1[2]).toBeNull()
    expect(d1[3]).toBeNull()
  })

  it('skips the smoothing pass entirely at breadcrumb cadence', () => {
    // The explicit windowSamples === 1 branch. Every sample here has a
    // different centred difference, so any averaging at all would pull them
    // toward each other — the exact raw values coming back out is the
    // assertion that no window ran.
    const t = [0, 600, 1200, 1800, 2400]
    const d1 = derivativeSeries([0, 60, 240, 540, 960], t, BREADCRUMB)

    for (const [i, expected] of [0.1, 0.2, 0.4, 0.6, 0.7].entries()) {
      expect(d1[i]).toBeCloseTo(expected, 10)
    }
  })

  it('is total on inputs too short to difference', () => {
    expect(derivativeSeries([], [], HZ1)).toEqual([])
    expect(derivativeSeries([5], [0], HZ1)).toEqual([null])
  })

  it('returns one entry per input sample, whatever the order', () => {
    const t = seconds(12)
    const values = t.map((ti) => ti * 2)
    expect(derivativeSeries(values, t, { ...HZ1 })).toHaveLength(12)
    expect(derivativeSeries(values, t, { ...HZ1, order: 2 })).toHaveLength(12)
  })

  it('nulls a run of missing data that no window can bridge', () => {
    // At 1 Hz the 9-wide window heals an isolated null — deliberately, same as
    // deriveSpeed. A dead channel wider than the window cannot be healed, and
    // must not come back as a confident 0.
    const t = seconds(40)
    const values = t.map((ti) => (ti >= 10 && ti <= 30 ? null : ti * 2))

    const d1 = derivativeSeries(values, t, HZ1)
    expect(d1[20]).toBeNull()
    expect(d1[5]).toBeCloseTo(2, 10)
  })
})
