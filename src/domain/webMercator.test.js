import { describe, it, expect } from 'vitest'
import { MAX_LATITUDE, projectLatLon } from './webMercator.js'

describe('projectLatLon', () => {
  it('puts null island at the centre of the unit square', () => {
    const { x, y } = projectLatLon(0, 0)
    expect(x).toBeCloseTo(0.5, 12)
    expect(y).toBeCloseTo(0.5, 12)
  })

  it('runs x west to east across [0,1]', () => {
    expect(projectLatLon(0, -180).x).toBeCloseTo(0, 12)
    expect(projectLatLon(0, 180).x).toBeCloseTo(1, 12)
    expect(projectLatLon(0, 90).x).toBeCloseTo(0.75, 12)
  })

  // Screen order, not geographic order. Every consumer — the canvas transform
  // and the slippy tile grid alike — numbers y downward, so getting this
  // backwards would show the route mirrored with no error anywhere.
  it('runs y NORTH to SOUTH, 0 at the top', () => {
    expect(projectLatLon(60, 0).y).toBeLessThan(0.5)
    expect(projectLatLon(-60, 0).y).toBeGreaterThan(0.5)
  })

  // The defining property of the projection: at ±MAX_LATITUDE the world is
  // exactly one unit square, which is what makes a tile pyramid possible.
  it('reaches exactly the corners of the unit square at the cutoff latitude', () => {
    expect(projectLatLon(MAX_LATITUDE, 0).y).toBeCloseTo(0, 8)
    expect(projectLatLon(-MAX_LATITUDE, 0).y).toBeCloseTo(1, 8)
  })

  it('clamps past the cutoff rather than diverging', () => {
    // y → ±Infinity at the true poles; without the clamp this poisons bounds
    // for the entire track.
    expect(projectLatLon(89.9, 0).y).toBe(projectLatLon(MAX_LATITUDE, 0).y)
    expect(projectLatLon(-90, 0).y).toBe(projectLatLon(-MAX_LATITUDE, 0).y)
  })

  // Pins the reference values that make this Web Mercator and not something
  // near it. Copenhagen, 55.6761°N 12.5683°E — checked against EPSG:3857
  // (x 1399096.8 m, y 7494204.7 m) over the 40075016.686 m world width.
  it('agrees with EPSG:3857 on a real coordinate', () => {
    const { x, y } = projectLatLon(55.6761, 12.5683)
    expect(x).toBeCloseTo(0.534911944, 9)
    expect(y).toBeCloseTo(0.312995594, 9)
  })

  // The line an out-and-back loop's shape depends on: Mercator stretches
  // north-south exactly as much as it stretches east-west at every point, and
  // plate carrée (y = lat/180 + 0.5) does not. At Copenhagen's latitude the two
  // differ by ~1.8×, which is the visible lopsidedness this projection avoids.
  it('is conformal — a degree of latitude spans more than a degree of longitude at 55°N', () => {
    const dy = projectLatLon(55.0, 0).y - projectLatLon(55.1, 0).y
    const dx = projectLatLon(55.0, 0.1).x - projectLatLon(55.0, 0).x
    expect(dy / dx).toBeCloseTo(1 / Math.cos((55.05 * Math.PI) / 180), 3)
  })
})
