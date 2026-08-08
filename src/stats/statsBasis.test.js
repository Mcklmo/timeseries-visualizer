import { describe, it, expect } from 'vitest'
import { fullDomain } from '../domain/zoomDomain.js'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { computeMetricStat } from './aggregate.js'
import { statsBasisFor } from './statsBasis.js'

// Slow first half (200 m in 100 s), fast second half (500 m in 100 s), so the
// window's average pace and the whole activity's are genuinely different
// numbers — the only way to catch a basis that slices samples but forgets the
// totals.
const activity = {
  totalTime: 200,
  totalMovingTime: 200,
  totalDistance: 700,
  samples: [
    { t: 0, d: 0, speed: 2, heartRate: 140, moving: true },
    { t: 100, d: 200, speed: 2, heartRate: 160, moving: true },
    { t: 200, d: 700, speed: 5, heartRate: 180, moving: true },
  ],
}
const fullExtent = [0, 200]

const avgPace = (basis) =>
  computeMetricStat({ ...basis, metric: metricRegistry.pace, statKind: 'avg' })

describe('statsBasisFor', () => {
  it('returns null when there is no activity', () => {
    expect(statsBasisFor(null, 't', fullDomain(), fullExtent)).toBeNull()
    expect(statsBasisFor(undefined, 't', fullDomain(), fullExtent)).toBeNull()
  })

  // Identity, not deep equality: the unzoomed render must stay byte-identical
  // to what it was before stats followed zoom, which means no copied array and
  // no recomputed totals on the path everyone lands on by default.
  it('hands back the activity itself, by reference, while unzoomed', () => {
    const basis = statsBasisFor(activity, 't', fullDomain(), fullExtent)
    expect(basis.samples).toBe(activity.samples)
    expect(basis.totalMovingTime).toBe(activity.totalMovingTime)
    expect(basis.totalDistance).toBe(activity.totalDistance)
  })

  it('takes the unzoomed path when there is no extent to resolve a window against', () => {
    const basis = statsBasisFor(activity, 't', [10, 20], null)
    expect(basis.samples).toBe(activity.samples)
  })

  it('slices the samples to the window', () => {
    const basis = statsBasisFor(activity, 't', [100, 200], fullExtent)
    expect(basis.samples.map((s) => s.t)).toEqual([100, 200])
  })

  it('slices on distance when the x-axis is distance', () => {
    const basis = statsBasisFor(activity, 'd', [0, 200], [0, 700])
    expect(basis.samples.map((s) => s.d)).toEqual([0, 200])
  })

  // THE test. computeMetricStat reads totalMovingTime/totalDistance off the
  // basis for weightedPace and never looks at the samples, so slicing alone
  // would leave average pace reporting the whole ride at every zoom level — a
  // wrong number that still looks plausible.
  it("recomputes the totals so the window's average pace is the window's", () => {
    const whole = statsBasisFor(activity, 't', fullDomain(), fullExtent)
    // 200 s / 700 m
    expect(avgPace(whole)).toBeCloseTo(285.714, 2)

    const fastHalf = statsBasisFor(activity, 't', [100, 200], fullExtent)
    expect(fastHalf.totalMovingTime).toBe(100)
    expect(fastHalf.totalDistance).toBe(500)
    // 100 s / 500 m = 200 s/km, i.e. the fast half, not the whole activity.
    expect(avgPace(fastHalf)).toBeCloseTo(200, 6)

    const slowHalf = statsBasisFor(activity, 't', [0, 100], fullExtent)
    expect(avgPace(slowHalf)).toBeCloseTo(500, 6)
  })

  // The header prints this one next to the activity's name, so it has to agree
  // with the span the x-axis draws — elapsed, pauses included, and measured
  // first-to-last exactly like the window's distance.
  describe('elapsedTime', () => {
    it("reports the activity's own elapsed total while unzoomed", () => {
      expect(statsBasisFor(activity, 't', fullDomain(), fullExtent).elapsedTime).toBe(200)
    })

    it('falls back to 0 rather than NaN when a fixture carries no totalTime', () => {
      const noTotalTime = { ...activity, totalTime: undefined }
      expect(statsBasisFor(noTotalTime, 't', fullDomain(), fullExtent).elapsedTime).toBe(0)
    })

    it('narrows to the window, measured first-to-last', () => {
      expect(statsBasisFor(activity, 't', [100, 200], fullExtent).elapsedTime).toBe(100)
    })

    // The axis may be metres; the duration never is. A distance window still
    // answers in seconds, or the header would print a length.
    it('is still measured in t when the x-axis is distance', () => {
      expect(statsBasisFor(activity, 'd', [0, 200], [0, 700]).elapsedTime).toBe(100)
    })

    // Elapsed, not moving: the 200→300 pause is inside the span the axis
    // draws, so a header that excluded it would disagree with the picture.
    it('counts a pause inside the window, unlike totalMovingTime', () => {
      const withPause = {
        samplingIntervalS: 100,
        totalMovingTime: 300,
        totalDistance: 600,
        samples: [
          { t: 0, d: 0, moving: true },
          { t: 100, d: 200, moving: true },
          { t: 200, d: 200, moving: false },
          { t: 300, d: 200, moving: false },
          { t: 400, d: 600, moving: true },
        ],
      }
      const basis = statsBasisFor(withPause, 't', [0, 400], [0, 400])
      expect(basis.elapsedTime).toBe(400)
      expect(basis.totalMovingTime).toBe(300)
    })

    it('reports an empty window as 0', () => {
      expect(statsBasisFor({ ...activity, samples: [] }, 't', [10, 20], fullExtent).elapsedTime).toBe(0)
    })
  })

  it('measures distance first-to-last inside the window, not cumulatively from the start', () => {
    const basis = statsBasisFor(activity, 't', [100, 200], fullExtent)
    // 700 (the last sample's cumulative d) would be the naive answer, and
    // would report the window as covering ground it never did.
    expect(basis.totalDistance).toBe(500)
  })

  it('windows the other stat kinds through the sliced samples', () => {
    const basis = statsBasisFor(activity, 't', [100, 200], fullExtent)
    const hr = (statKind) =>
      computeMetricStat({ ...basis, metric: metricRegistry.heartRate, statKind })
    expect(hr('max')).toBe(180) // 140 is outside the window
    expect(hr('min')).toBe(160)
  })

  it('drops a pause out of the window moving time, so it is less than the wall span', () => {
    const withPause = {
      samplingIntervalS: 100,
      totalMovingTime: 300,
      totalDistance: 600,
      samples: [
        { t: 0, d: 0, moving: true },
        { t: 100, d: 200, moving: true },
        { t: 200, d: 200, moving: false }, // stopped
        { t: 300, d: 200, moving: false },
        { t: 400, d: 600, moving: true },
      ],
    }
    const basis = statsBasisFor(withPause, 't', [0, 400], [0, 400])
    // 400 s of wall clock, of which the 200→300 interval (stopped at both
    // ends) was not travelled. The 100→200 and 300→400 boundary intervals
    // still count — see sampleDurations.
    expect(basis.totalMovingTime).toBe(300)
    expect(basis.totalDistance).toBe(600)
  })

  it('gives a recording gap inside the window no weight', () => {
    const withDropout = {
      samplingIntervalS: 600, // gapThresholdFor(600) = 2400 s
      totalMovingTime: 1200,
      totalDistance: 1440,
      samples: [
        { t: 0, d: 0, moving: true },
        { t: 600, d: 720, moving: true },
        { t: 22800, d: 1440, moving: true }, // after a 6-hour dropout
      ],
    }
    const basis = statsBasisFor(withDropout, 't', [0, 22800], [0, 22800])
    // The 600 → 22800 interval is a dropout, not travel: 600 s counts, the
    // other 22,200 do not.
    expect(basis.totalMovingTime).toBe(600)
  })

  it('derives gapThresholdS from the sampling interval, and leaves it undefined without one', () => {
    expect(statsBasisFor({ ...activity, samplingIntervalS: 600 }, 't', fullDomain(), fullExtent).gapThresholdS).toBe(2400)
    expect(statsBasisFor({ ...activity, samplingIntervalS: 1 }, 't', fullDomain(), fullExtent).gapThresholdS).toBe(10)
    // NOT gapThresholdFor(undefined), which is 10 — that would read every
    // interval of a hand-built or sparse activity as a gap and zero every
    // weight.
    expect(statsBasisFor(activity, 't', fullDomain(), fullExtent).gapThresholdS).toBeUndefined()
  })

  it('widens a window too narrow to contain a sample to the pair the line spans', () => {
    const basis = statsBasisFor(activity, 't', [40, 60], fullExtent)
    expect(basis.samples.map((s) => s.t)).toEqual([0, 100])
    expect(basis.totalDistance).toBe(200)
  })

  it('reports an empty window as zeros, and every stat as null rather than NaN', () => {
    const basis = statsBasisFor({ ...activity, samples: [] }, 't', [10, 20], fullExtent)
    expect(basis.samples).toEqual([])
    expect(basis.totalMovingTime).toBe(0)
    expect(basis.totalDistance).toBe(0)
    for (const statKind of ['max', 'min', 'avg', 'median']) {
      expect(computeMetricStat({ ...basis, metric: metricRegistry.pace, statKind })).toBeNull()
      expect(computeMetricStat({ ...basis, metric: metricRegistry.heartRate, statKind })).toBeNull()
    }
  })

  it('reports a single-sample window without dividing by zero', () => {
    const basis = statsBasisFor(activity, 't', [95, 105], fullExtent)
    expect(basis.samples.map((s) => s.t)).toEqual([100])
    expect(basis.totalMovingTime).toBe(0)
    expect(basis.totalDistance).toBe(0)
    expect(avgPace(basis)).toBeNull()
    // The instantaneous kinds are still meaningful on one sample.
    expect(computeMetricStat({ ...basis, metric: metricRegistry.heartRate, statKind: 'max' })).toBe(160)
  })
})
