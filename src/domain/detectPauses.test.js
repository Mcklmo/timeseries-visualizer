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

// Both thresholds scale with the recording's own cadence now. Every assertion
// above runs at the implicit 1 Hz default and is unchanged, which is the point
// — a watch file must detect exactly the pauses it always did.
describe('detectPauses at sparse sampling rates', () => {
  it('treats an ordinary breadcrumb interval as moving, not as one long pause', () => {
    // A position every 10 minutes: under the old fixed 10s threshold, every
    // sample past the first was "paused" and moving time collapsed to zero.
    const t = [0, 600, 1200, 1800, 2400]
    const speed = [2, 2, 2, 2, 2]
    expect(detectPauses({ t, speed, intervalS: 600 })).toEqual([true, true, true, true, true])
  })

  it('still flags a real dropout — four missed breadcrumbs and up', () => {
    const t = [0, 600, 1200, 24000, 24600] // 6.3h outage before index 3
    const speed = [2, 2, 2, 2, 2]
    expect(detectPauses({ t, speed, intervalS: 600 })).toEqual([true, true, true, false, true])
  })

  it('scales the sustained-slow trigger too, so one slow breadcrumb is not a stop', () => {
    const t = [0, 600, 1200, 1800]
    const speed = [2, 0.1, 2, 2]
    expect(detectPauses({ t, speed, intervalS: 600 })).toEqual([true, true, true, true])
  })

  it('flags a genuinely stationary stretch at sparse sampling', () => {
    const t = [0, 600, 1200, 1800, 5400, 6000]
    const speed = [2, 0.1, 0.1, 0.1, 0.1, 2]
    const result = detectPauses({ t, speed, intervalS: 600 })
    expect(result.slice(1, 5)).toEqual([false, false, false, false])
  })

  it('defaults to 1 Hz behaviour when no interval is given', () => {
    const t = [0, 1, 2, 20, 21]
    const speed = [3, 3, 3, 3, 3]
    expect(detectPauses({ t, speed })).toEqual(detectPauses({ t, speed, intervalS: 1 }))
  })
})
