import { describe, it, expect } from 'vitest'
import { smooth } from './smooth.js'

describe('smooth', () => {
  it('averages within a centred window', () => {
    // window 3 at i=2: average of indices 1..3 = (2+3+4)/3 = 3
    const result = smooth([1, 2, 3, 4, 5], 3)
    expect(result[2]).toBeCloseTo(3, 6)
  })

  it('shrinks the window at the edges instead of padding with zeros', () => {
    // i=0, window 3 -> only indices 0..1 exist -> (1+2)/2 = 1.5, not (0+1+2)/3
    const result = smooth([1, 2, 3, 4, 5], 3)
    expect(result[0]).toBeCloseTo(1.5, 6)
    expect(result[4]).toBeCloseTo(4.5, 6)
  })

  it('skips nulls rather than treating them as zero', () => {
    const result = smooth([1, null, 3], 3)
    // window covers all three; only 1 and 3 are numeric -> mean 2, not (1+0+3)/3
    expect(result[1]).toBeCloseTo(2, 6)
  })

  it('returns null where the whole window has no data', () => {
    const result = smooth([null, null, null], 3)
    expect(result).toEqual([null, null, null])
  })

  it('preserves array length', () => {
    expect(smooth([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(7)
  })
})
