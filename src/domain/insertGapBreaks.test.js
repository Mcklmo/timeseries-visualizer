import { describe, it, expect } from 'vitest'
import { insertGapBreaks } from './insertGapBreaks.js'

const rowsOf = (pairs) => pairs.map(([t, d, v]) => ({ t, d, speed: v }))

describe('insertGapBreaks', () => {
  it('leaves an evenly sampled series untouched', () => {
    const rows = rowsOf([
      [0, 0, 3],
      [10, 30, 3],
      [20, 60, 3],
    ])
    expect(insertGapBreaks(rows, { metricId: 'speed', gapThresholdS: 40 })).toEqual(rows)
  })

  it('inserts exactly one null-valued row inside a gap past the threshold', () => {
    const rows = rowsOf([
      [0, 0, 3],
      [600, 500, 3],
      [24000, 1000, 3], // 6.5h dropout
    ])
    const out = insertGapBreaks(rows, { metricId: 'speed', gapThresholdS: 2400 })

    expect(out).toHaveLength(4)
    expect(out[2].speed).toBeNull()
    expect(out.filter((r) => r.speed === null)).toHaveLength(1)
  })

  it('places the break at the midpoint of BOTH axes, since xKey flips with xMode', () => {
    const rows = rowsOf([
      [0, 0, 3],
      [1000, 400, 3],
    ])
    const [, gap] = insertGapBreaks(rows, { metricId: 'speed', gapThresholdS: 100 })

    expect(gap.t).toBe(500)
    expect(gap.d).toBe(200)
  })

  it('does not break on a gap of exactly the threshold', () => {
    const rows = rowsOf([
      [0, 0, 3],
      [10, 30, 3],
    ])
    expect(insertGapBreaks(rows, { metricId: 'speed', gapThresholdS: 10 })).toHaveLength(2)
  })

  it('nulls the metric it was given, whichever that is', () => {
    const rows = [
      { t: 0, d: 0, altitude: 100 },
      { t: 5000, d: 900, altitude: 140 },
    ]
    const [, gap] = insertGapBreaks(rows, { metricId: 'altitude', gapThresholdS: 60 })
    expect(gap.altitude).toBeNull()
  })

  it('handles empty and single-row input', () => {
    expect(insertGapBreaks([], { metricId: 'speed', gapThresholdS: 10 })).toEqual([])
    expect(insertGapBreaks(rowsOf([[0, 0, 3]]), { metricId: 'speed', gapThresholdS: 10 })).toHaveLength(1)
  })
})
