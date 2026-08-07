import { describe, it, expect } from 'vitest'
import { buildDistanceAxis } from './buildDistanceAxis.js'

describe('buildDistanceAxis', () => {
  it('passes through clean monotonic distance unchanged', () => {
    const result = buildDistanceAxis([{ distanceMeters: 0 }, { distanceMeters: 10 }, { distanceMeters: 25 }])
    expect(result).toEqual([0, 10, 25])
  })

  it('clamps a decrease/reset to the previous value instead of going backwards', () => {
    // e.g. a GPS distance field that resets mid-lap
    const result = buildDistanceAxis([{ distanceMeters: 0 }, { distanceMeters: 50 }, { distanceMeters: 5 }])
    expect(result).toEqual([0, 50, 50])
  })

  it('holds the last known value forward through a missing sample', () => {
    const result = buildDistanceAxis([{ distanceMeters: 0 }, { distanceMeters: null }, { distanceMeters: 20 }])
    expect(result).toEqual([0, 0, 20])
  })

  it('falls back to haversine over lat/lon when distance is absent from every trackpoint', () => {
    // Roughly 1 degree of latitude ~= 111.2 km — walk a small, known step south.
    const result = buildDistanceAxis([
      { lat: 0, lon: 0 },
      { lat: -0.001, lon: 0 }, // ~111.2m south
    ])
    expect(result[0]).toBe(0)
    expect(result[1]).toBeGreaterThan(100)
    expect(result[1]).toBeLessThan(120)
  })

  it('is monotonically non-decreasing even when GPS points double back', () => {
    const result = buildDistanceAxis([
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0 },
      { lat: 0, lon: 0 }, // runner doubles back — cumulative distance must still grow
    ])
    expect(result[2]).toBeGreaterThan(result[1])
  })
})
