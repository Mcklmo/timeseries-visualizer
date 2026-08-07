import { describe, it, expect } from 'vitest'
import { sampleDurations, totalMovingTimeOf } from './sampleDurations.js'

describe('sampleDurations', () => {
  it('gives each sample the interval forward to the next one, and the last sample 0', () => {
    const samples = [{ t: 0 }, { t: 10 }, { t: 25 }]
    expect(sampleDurations(samples)).toEqual([10, 15, 0])
  })

  it('counts every interval when no gapThresholdS is given', () => {
    // The default is Infinity, not gapThresholdFor(undefined) — a caller with
    // no measured cadence keeps the historical "count everything" behaviour.
    const samples = [{ t: 0 }, { t: 100 }, { t: 200 }]
    expect(sampleDurations(samples)).toEqual([100, 100, 0])
  })

  it('scores a recording gap 0 — time the device was not logging is not time we know anything about', () => {
    const samples = [{ t: 0 }, { t: 10 }, { t: 3610 }, { t: 3620 }]
    expect(sampleDurations(samples, { gapThresholdS: 10 })).toEqual([10, 0, 10, 0])
  })

  it('keeps an interval exactly at the threshold — the comparison is strictly greater-than', () => {
    const samples = [{ t: 0 }, { t: 10 }]
    expect(sampleDurations(samples, { gapThresholdS: 10 })).toEqual([10, 0])
  })

  it('scores a non-positive dt 0, so duplicate or out-of-order timestamps carry no duration', () => {
    const samples = [{ t: 0 }, { t: 0 }, { t: 5 }, { t: 3 }]
    expect(sampleDurations(samples)).toEqual([0, 5, 0, 0])
  })

  describe('movingOnly', () => {
    it('drops an interval stopped at BOTH ends — that is a pause', () => {
      const samples = [
        { t: 0, moving: false },
        { t: 10, moving: false },
      ]
      expect(sampleDurations(samples, { movingOnly: true })).toEqual([0, 0])
    })

    it('keeps a boundary interval with exactly one stopped end', () => {
      // detectPauses flags the sample that RESUMES after a gap, never the one
      // before it, so the interval into a pause (moving -> stopped) and the
      // first interval out of one (stopped -> moving) are both real travel.
      const decelerating = [
        { t: 0, moving: true },
        { t: 10, moving: false },
      ]
      const resuming = [
        { t: 0, moving: false },
        { t: 10, moving: true },
      ]
      expect(sampleDurations(decelerating, { movingOnly: true })).toEqual([10, 0])
      expect(sampleDurations(resuming, { movingOnly: true })).toEqual([10, 0])
    })

    it('still scores a gap 0 even when both ends are moving', () => {
      const samples = [
        { t: 0, moving: true },
        { t: 3600, moving: true },
        { t: 3610, moving: true },
      ]
      expect(sampleDurations(samples, { gapThresholdS: 10, movingOnly: true })).toEqual([0, 10, 0])
    })

    it('treats a sample with no moving flag at all as moving', () => {
      const samples = [{ t: 0 }, { t: 10 }]
      expect(sampleDurations(samples, { movingOnly: true })).toEqual([10, 0])
    })
  })
})

describe('totalMovingTimeOf', () => {
  it('sums the intervals that were both recorded and travelled', () => {
    const samples = [
      { t: 0, moving: true }, //     +10 -> travelled
      { t: 10, moving: true }, //    +10 -> boundary into the pause, counted
      { t: 20, moving: false }, //   +10 -> both ends stopped, dropped
      { t: 30, moving: false }, // 3600s gap -> dropped as a gap
      { t: 3630, moving: true }, //  +10 -> travelled
      { t: 3640, moving: true }, //  last sample, 0
    ]
    expect(totalMovingTimeOf(samples, 10)).toBe(30)
  })

  it('is 0 for an empty or single-sample recording', () => {
    expect(totalMovingTimeOf([], 10)).toBe(0)
    expect(totalMovingTimeOf([{ t: 0, moving: true }], 10)).toBe(0)
  })
})
