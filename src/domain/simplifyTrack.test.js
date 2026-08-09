import { describe, it, expect } from 'vitest'
import { keptIndexAtOrAfter, simplifyTrack } from './simplifyTrack.js'

// A scale of 1000 makes the arithmetic readable: one unit of normalised
// Mercator is 1000px, so a step of 0.001 is exactly one pixel.
const fit = { scale: 1000, offsetX: 0, offsetY: 0 }

/** @param {number[][]} points [x, y] pairs in normalised Mercator */
function trackOf(points) {
  return {
    x: Float64Array.from(points, ([x]) => x),
    y: Float64Array.from(points, ([, y]) => y),
    bounds: { x0: 0, y0: 0, x1: 1, y1: 1 },
    fixCount: points.length,
  }
}

const gap = [NaN, NaN]

describe('simplifyTrack', () => {
  it('keeps every point when they are all further apart than the threshold', () => {
    const track = trackOf([
      [0, 0],
      [0.01, 0],
      [0.02, 0],
    ])
    expect([...simplifyTrack(track, fit)]).toEqual([0, 1, 2])
  })

  it('drops points within minPx of the last KEPT one, not of their neighbour', () => {
    // Six points 0.4px apart. Measuring against the neighbour would keep none
    // of them; measuring against the last kept point keeps every other one,
    // which is what bounds the error at minPx rather than letting it drift.
    const track = trackOf([
      [0, 0],
      [0.0004, 0],
      [0.0008, 0],
      [0.0012, 0],
      [0.0016, 0],
      [0.002, 0],
    ])
    expect([...simplifyTrack(track, fit, 0.75)]).toEqual([0, 2, 4])
  })

  it('measures radially, so a point that moved only in y is still kept', () => {
    const track = trackOf([
      [0, 0],
      [0, 0.002],
    ])
    expect([...simplifyTrack(track, fit, 0.75)]).toEqual([0, 1])
  })

  it('returns indices into the original arrays', () => {
    const track = trackOf([
      [0, 0],
      [0.00001, 0],
      [0.00002, 0],
      [0.5, 0],
    ])
    // The three clustered points collapse to one; the survivor's index is 3,
    // not 1 — that is what lets the zoom window be located later.
    expect([...simplifyTrack(track, fit, 0.75)]).toEqual([0, 3])
  })

  // A dropout is a gap, not a straight line across a city. drawRoute reads a
  // NaN slot as "lift the pen", so decimation must not silently remove it.
  it('keeps the gap marker so the stroke can be broken', () => {
    const track = trackOf([
      [0, 0],
      gap,
      [0.5, 0],
    ])
    expect([...simplifyTrack(track, fit, 0.75)]).toEqual([0, 1, 2])
  })

  it('collapses a run of missing fixes to one marker', () => {
    const track = trackOf([[0, 0], gap, gap, gap, [0.5, 0]])
    expect([...simplifyTrack(track, fit, 0.75)]).toEqual([0, 1, 4])
  })

  it('always keeps the first fix after a gap, however close it is to the last one', () => {
    // Without resetting the reference point across the gap, this sub-pixel
    // step would be dropped and the stroke would resume from stale state.
    const track = trackOf([
      [0, 0],
      gap,
      [0.00001, 0],
      [0.5, 0],
    ])
    expect([...simplifyTrack(track, fit, 0.75)]).toEqual([0, 1, 2, 3])
  })

  it('emits no marker for a track that opens with missing fixes', () => {
    // There is no stroke in flight yet, so there is nothing to break.
    const track = trackOf([gap, gap, [0, 0], [0.5, 0]])
    expect([...simplifyTrack(track, fit, 0.75)]).toEqual([2, 3])
  })

  it('keeps more points as the fit gets larger', () => {
    const track = trackOf(Array.from({ length: 200 }, (_, i) => [i * 0.0001, 0]))
    const small = simplifyTrack(track, { scale: 1000, offsetX: 0, offsetY: 0 })
    const large = simplifyTrack(track, { scale: 100000, offsetX: 0, offsetY: 0 })
    expect(large.length).toBeGreaterThan(small.length)
    expect(large.length).toBe(200)
  })

  it('is total — a missing track or fit yields an empty result rather than a throw', () => {
    expect(simplifyTrack(null, fit)).toHaveLength(0)
    expect(simplifyTrack(trackOf([[0, 0]]), null)).toHaveLength(0)
  })
})

describe('keptIndexAtOrAfter', () => {
  const indices = Int32Array.from([0, 4, 9, 20, 21])

  it('finds an exact hit', () => {
    expect(keptIndexAtOrAfter(indices, 9)).toBe(2)
  })

  it('finds the first slot at or after a value that was decimated away', () => {
    expect(keptIndexAtOrAfter(indices, 5)).toBe(2)
  })

  it('answers 0 below the range and length above it', () => {
    expect(keptIndexAtOrAfter(indices, -3)).toBe(0)
    expect(keptIndexAtOrAfter(indices, 99)).toBe(5)
    expect(keptIndexAtOrAfter(Int32Array.from([]), 3)).toBe(0)
  })
})
