import { describe, it, expect } from 'vitest'
import { deriveSpeed } from './deriveSpeed.js'

describe('deriveSpeed', () => {
  it('uses sensor speed directly, unmodified, when the file has any', () => {
    const trackpoints = [{ speedMps: 3 }, { speedMps: 3.5 }, { speedMps: null }]
    const result = deriveSpeed({ trackpoints, t: [0, 1, 2], d: [0, 3, 6.5] })
    // third point had no sensor reading -> stays null, not derived from distance
    expect(result).toEqual([3, 3.5, null])
  })

  it('derives from distance/time deltas and smooths when speed is absent entirely', () => {
    const trackpoints = [{}, {}, {}, {}, {}]
    const t = [0, 1, 2, 3, 4]
    const d = [0, 3, 6, 9, 12] // steady 3 m/s
    const result = deriveSpeed({ trackpoints, t, d })
    result.forEach((v) => expect(v).toBeCloseTo(3, 6))
  })

  it('smooths out a single noisy sample rather than reproducing it exactly', () => {
    const trackpoints = [{}, {}, {}, {}, {}]
    const t = [0, 1, 2, 3, 4]
    const d = [0, 3, 6, 20, 23] // one bogus jump at index 3 (14 m in 1s)
    const result = deriveSpeed({ trackpoints, t, d })
    // the smoothed value at the spike is pulled well below the raw 14 m/s
    expect(result[3]).toBeLessThan(10)
  })

  it('backfills the first sample instead of leaving it null', () => {
    const trackpoints = [{}, {}, {}]
    const result = deriveSpeed({ trackpoints, t: [0, 1, 2], d: [0, 4, 8] })
    expect(result[0]).not.toBeNull()
  })
})

// The smoothing window is 9 *seconds*, converted to samples at the recording's
// own cadence — it used to be a flat 9 samples, which is half a day of
// smoothing on a 10-minute-cadence log.
describe('deriveSpeed smoothing window', () => {
  it('still spans 9 samples at 1 Hz — the pre-adaptive constant', () => {
    // A lone spike is averaged over the 9 samples centred on it: 14 m/s worth
    // of extra distance spread across the window lands just under 5 m/s.
    const trackpoints = Array.from({ length: 11 }, () => ({}))
    const t = Array.from({ length: 11 }, (_, i) => i)
    const d = t.map((i) => (i < 6 ? i * 3 : i * 3 + 14))
    const result = deriveSpeed({ trackpoints, t, d, intervalS: 1 })

    expect(result[6]).toBeCloseTo(3 + 14 / 9, 6)
    expect(result).toEqual(deriveSpeed({ trackpoints, t, d })) // same as the default
  })

  it('skips smoothing entirely at breadcrumb cadence — a 10-minute delta is already an average', () => {
    const trackpoints = Array.from({ length: 5 }, () => ({}))
    const t = [0, 600, 1200, 1800, 2400]
    const d = [0, 1200, 2400, 6000, 7200] // one genuinely faster leg
    const result = deriveSpeed({ trackpoints, t, d, intervalS: 600 })

    // The fast leg is reported as it happened (6 m/s), not smeared into its
    // neighbours — with a 9-sample window it would have been.
    expect(result[3]).toBeCloseTo(6, 6)
    expect(result[4]).toBeCloseTo(2, 6)
  })
})
