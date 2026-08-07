import { describe, it, expect } from 'vitest'
import { detectPauses } from './detectPauses.js'

describe('detectPauses', () => {
  it('marks everything moving when there are no gaps or slow stretches', () => {
    const result = detectPauses({ t: [0, 1, 2, 3], speed: [3, 3, 3, 3] })
    expect(result).toEqual([true, true, true, true])
  })

  it('marks the sample after a >10s recording gap as not moving', () => {
    const result = detectPauses({ t: [0, 1, 2, 20, 21], speed: [3, 3, 3, 3, 3] })
    expect(result).toEqual([true, true, true, false, true])
  })

  it('does not flag a gap of exactly 10s or less', () => {
    const result = detectPauses({ t: [0, 5, 10], speed: [3, 3, 3] })
    expect(result).toEqual([true, true, true])
  })

  it('marks a sustained (>10s) stretch of near-zero speed as not moving', () => {
    const t = [0, 2, 4, 6, 8, 10, 12, 14]
    const speed = [3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 3]
    const result = detectPauses({ t, speed })
    // the slow run spans indices 1..6, t[6]-t[1] = 10, not > 10 -> not flagged yet
    expect(result).toEqual([true, true, true, true, true, true, true, true])
  })

  it('flags a slow stretch once it exceeds 10s', () => {
    const t = [0, 2, 4, 6, 8, 10, 12, 14, 16]
    const speed = [3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 3]
    const result = detectPauses({ t, speed })
    expect(result.slice(1, 8)).toEqual([false, false, false, false, false, false, false])
    expect(result[0]).toBe(true)
    expect(result[8]).toBe(true)
  })

  it('does not flag a brief dip below the speed threshold', () => {
    const result = detectPauses({ t: [0, 1, 2, 3], speed: [3, 0.1, 0.1, 3] })
    expect(result).toEqual([true, true, true, true])
  })

  it('treats null speed as not slow (no data, not a stop)', () => {
    const result = detectPauses({ t: [0, 5, 15, 25], speed: [3, null, null, 3] })
    expect(result).toEqual([true, true, true, true])
  })

  it('keeps sample count identical to input (never deletes samples)', () => {
    const t = [0, 20, 40]
    const speed = [3, 3, 3]
    expect(detectPauses({ t, speed })).toHaveLength(3)
  })
})
