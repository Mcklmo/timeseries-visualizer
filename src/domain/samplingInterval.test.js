import { describe, it, expect } from 'vitest'
import { gapThresholdFor, medianIntervalOf } from './samplingInterval.js'

describe('medianIntervalOf', () => {
  it('returns the median gap between consecutive samples', () => {
    expect(medianIntervalOf([0, 1, 2, 3, 4])).toBe(1)
    expect(medianIntervalOf([0, 600, 1200, 1800])).toBe(600)
  })

  it('averages the two middle gaps for an even number of intervals', () => {
    // deltas: 2, 4 -> (2+4)/2
    expect(medianIntervalOf([0, 2, 6])).toBe(3)
  })

  it('is not dragged up by a single long dropout — the whole reason it is a median', () => {
    // 10-minute breadcrumbs with one 6-hour satellite outage in the middle
    const t = [0, 600, 1200, 1800, 23400, 24000, 24600]
    expect(medianIntervalOf(t)).toBe(600)
  })

  it('returns 1 for fewer than two samples', () => {
    expect(medianIntervalOf([])).toBe(1)
    expect(medianIntervalOf([0])).toBe(1)
  })

  it('ignores duplicate and out-of-order timestamps rather than reporting a zero cadence', () => {
    expect(medianIntervalOf([0, 0, 0])).toBe(1)
    expect(medianIntervalOf([0, 5, 5, 10])).toBe(5)
  })
})

describe('gapThresholdFor', () => {
  // Pins "nothing changes for Garmin files": this is the exact constant
  // detectPauses carried before it became sampling-rate aware.
  it('returns exactly 10s at 1 Hz — the pre-adaptive constant', () => {
    expect(gapThresholdFor(1)).toBe(10)
  })

  it('stays at 10s for anything sampled faster than 2.5s', () => {
    expect(gapThresholdFor(0.5)).toBe(10)
    expect(gapThresholdFor(2)).toBe(10)
    expect(gapThresholdFor(2.5)).toBe(10)
  })

  it('scales to four sample intervals for sparse recordings', () => {
    expect(gapThresholdFor(600)).toBe(2400) // SPOT-style 10-minute breadcrumbs -> 40 min
    expect(gapThresholdFor(150)).toBe(600)
  })

  it('falls back to the floor for a missing or nonsensical interval', () => {
    expect(gapThresholdFor(undefined)).toBe(10)
    expect(gapThresholdFor(0)).toBe(10)
    expect(gapThresholdFor(-5)).toBe(10)
  })
})
