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
