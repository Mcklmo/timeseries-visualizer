import { describe, it, expect } from 'vitest'
import { computeMetricStat, computeYDomain } from './aggregate.js'

const paceAccessor = (s) => (s.speed && s.speed > 0.3 ? 1000 / s.speed : null)
const paceMetric = { accessor: paceAccessor, aggStrategy: 'weightedPace', invertAxis: true }

describe('weightedPace avg — the one that must match Garmin', () => {
  // Two equal-TIME segments (realistic ~1 Hz GPS sampling), different speed:
  //   Segment A: 5 m/s for 100s  -> 500m,  instantaneous pace = 200 s/km
  //   Segment B: 2 m/s for 100s  -> 200m,  instantaneous pace = 500 s/km
  // Correct avg pace = totalMovingTime / totalDistance = 200s / 700m * 1000 = 285.71 s/km
  // Naive arithmetic mean of the two instantaneous paces = (200+500)/2 = 350 s/km
  // These MUST differ — that gap is exactly the bug the architecture doc warns about
  // (AM-HM inequality: mean-of-pace always overstates pace when speed varies).
  const samples = [
    { t: 0, d: 0, speed: 5, moving: true },
    { t: 100, d: 500, speed: 2, moving: true },
    { t: 200, d: 700, speed: 2, moving: true }, // closes out segment B's duration
  ]
  const totals = { totalMovingTime: 200, totalDistance: 700 }

  it('computes avg pace as totalMovingTime / totalDistance, not mean-of-instantaneous-pace', () => {
    const result = computeMetricStat({
      samples,
      metric: paceMetric,
      statKind: 'avg',
      ...totals,
    })
    expect(result).toBeCloseTo(285.714, 2)
  })

  it('does not equal the naive (wrong) mean of instantaneous pace', () => {
    const result = computeMetricStat({
      samples,
      metric: paceMetric,
      statKind: 'avg',
      ...totals,
    })
    expect(result).not.toBeCloseTo(350, 2)
  })

  it('max/median still read instantaneous pace per sample (fastest/typical moment, not the total)', () => {
    const max = computeMetricStat({
      samples,
      metric: paceMetric,
      statKind: 'max',
      ...totals,
    })
    const median = computeMetricStat({
      samples,
      metric: paceMetric,
      statKind: 'median',
      ...totals,
    })
    // "max" pace = fastest moment = smallest s/km value = 200 (invertAxis-aware)
    expect(max).toBeCloseTo(200, 6)
    // median is NOT direction-aware (only `max` is, per spec) — plain sorted
    // middle of [200, 500, 500] is 500, even though that's the "slower" value
    expect(median).toBeCloseTo(500, 6)
  })
})

describe('timeWeighted avg (heart rate, power, altitude)', () => {
  it('weights by the duration each sample represents, not sample count', () => {
    // One sample at hr=100 lasting 90s, then 9 samples at hr=150 lasting 10s each (90s).
    // Naive array mean would be dominated by the 9 dense samples: ~145.
    // Time-weighted mean must be exactly 125 (90s@100 + 90s@150, i.e. an even split).
    const samples = [
      { t: 0, hr: 100 },
      ...Array.from({ length: 9 }, (_, i) => ({ t: 90 + i * 10, hr: 150 })),
      { t: 180, hr: 150 }, // closes the duration of the last real sample
    ]
    const result = computeMetricStat({
      samples,
      metric: { accessor: (s) => s.hr, aggStrategy: 'timeWeighted' },
      statKind: 'avg',
      totalMovingTime: 180,
      totalDistance: 500,
    })
    expect(result).toBeCloseTo(125, 6)
  })

  it('includes non-moving samples (paused heart rate is still real data)', () => {
    const samples = [
      { t: 0, hr: 100, moving: true },
      { t: 60, hr: 100, moving: false },
      { t: 120, hr: 100, moving: true },
      { t: 180, hr: 100, moving: true },
    ]
    const result = computeMetricStat({
      samples,
      metric: { accessor: (s) => s.hr, aggStrategy: 'timeWeighted' },
      statKind: 'avg',
      totalMovingTime: 120,
      totalDistance: 500,
    })
    expect(result).toBeCloseTo(100, 6)
  })
})

describe('movingOnly avg (cadence)', () => {
  it('excludes moving:false samples entirely — standing still is "no data", not 0', () => {
    const samples = [
      { t: 0, cadence: 170, moving: true },
      { t: 10, cadence: 0, moving: false }, // standing at a light
      { t: 20, cadence: 0, moving: false },
      { t: 30, cadence: 170, moving: true },
    ]
    const result = computeMetricStat({
      samples,
      metric: { accessor: (s) => s.cadence, aggStrategy: 'movingOnly' },
      statKind: 'avg',
      totalMovingTime: 20,
      totalDistance: 100,
    })
    expect(result).toBeCloseTo(170, 6)
  })

  it('excludes paused samples from max too', () => {
    const samples = [
      { t: 0, cadence: 170, moving: true },
      { t: 10, cadence: 999, moving: false }, // sensor noise while stopped
      { t: 20, cadence: 175, moving: true },
    ]
    const result = computeMetricStat({
      samples,
      metric: { accessor: (s) => s.cadence, aggStrategy: 'movingOnly' },
      statKind: 'max',
      totalMovingTime: 20,
      totalDistance: 100,
    })
    expect(result).toBe(175)
  })
})

describe('median — always moving-only, unweighted, raw', () => {
  it('excludes non-moving samples regardless of the metric strategy', () => {
    const samples = [
      { t: 0, hr: 90, moving: false },
      { t: 10, hr: 140, moving: true },
      { t: 20, hr: 150, moving: true },
      { t: 30, hr: 160, moving: true },
    ]
    const result = computeMetricStat({
      samples,
      metric: { accessor: (s) => s.hr, aggStrategy: 'timeWeighted' },
      statKind: 'median',
      totalMovingTime: 20,
      totalDistance: 100,
    })
    expect(result).toBe(150)
  })
})

describe('computeYDomain', () => {
  it('returns undefined when the metric does not opt in via domainPadding', () => {
    const samples = [
      { t: 0, cadence: 170, moving: true },
      { t: 10, cadence: 180, moving: true },
    ]
    const result = computeYDomain({
      samples,
      metric: { accessor: (s) => s.cadence, aggStrategy: 'movingOnly' },
    })
    expect(result).toBeUndefined()
  })

  it('excludes moving:false samples for a movingOnly metric, so a paused 0 does not lower the min', () => {
    const samples = [
      { t: 0, cadence: 165, moving: true },
      { t: 10, cadence: 0, moving: false }, // standing at a light
      { t: 20, cadence: 190, moving: true },
    ]
    const result = computeYDomain({
      samples,
      metric: { accessor: (s) => s.cadence, aggStrategy: 'movingOnly', domainPadding: 0.08 },
    })
    // range = 190 - 165 = 25, pad = 25 * 0.08 = 2
    expect(result).toEqual([163, 192])
  })

  it('pads [min, max] by the given fraction of the range', () => {
    const samples = [
      { t: 0, v: 100, moving: true },
      { t: 10, v: 200, moving: true },
    ]
    const result = computeYDomain({
      samples,
      metric: { accessor: (s) => s.v, domainPadding: 0.1 },
    })
    // range = 100, pad = 10
    expect(result).toEqual([90, 210])
  })

  it('clamps the lower bound at 0', () => {
    const samples = [
      { t: 0, v: 5, moving: true },
      { t: 10, v: 10, moving: true },
    ]
    const result = computeYDomain({
      samples,
      metric: { accessor: (s) => s.v, domainPadding: 1 }, // pad = (10-5)*1 = 5 -> min - pad = 0, still clamp path
    })
    expect(result[0]).toBe(0)
  })

  it('falls back to a fixed pad of 1 when min equals max (constant value)', () => {
    const samples = [
      { t: 0, v: 150, moving: true },
      { t: 10, v: 150, moving: true },
    ]
    const result = computeYDomain({
      samples,
      metric: { accessor: (s) => s.v, domainPadding: 0.08 },
    })
    expect(result).toEqual([149, 151])
  })

  it('returns undefined when there are no valid (non-null, finite) values', () => {
    const samples = [
      { t: 0, v: null, moving: true },
      { t: 10, v: undefined, moving: true },
    ]
    const result = computeYDomain({
      samples,
      metric: { accessor: (s) => s.v, domainPadding: 0.08 },
    })
    expect(result).toBeUndefined()
  })
})

describe('null handling', () => {
  it('returns null when there is nothing to aggregate', () => {
    const result = computeMetricStat({
      samples: [{ t: 0, power: null, moving: true }],
      metric: { accessor: (s) => s.power, aggStrategy: 'timeWeighted' },
      statKind: 'avg',
      totalMovingTime: 0,
      totalDistance: 0,
    })
    expect(result).toBeNull()
  })

  it('weightedPace avg returns null when totalDistance is 0', () => {
    const result = computeMetricStat({
      samples: [],
      metric: paceMetric,
      statKind: 'avg',
      totalMovingTime: 0,
      totalDistance: 0,
    })
    expect(result).toBeNull()
  })
})
