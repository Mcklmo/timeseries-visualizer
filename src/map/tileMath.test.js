import { describe, it, expect } from 'vitest'
import { tileKey, tileRect, tilesCovering, tileZoomFor } from './tileMath.js'

describe('tileZoomFor', () => {
  // At zoom z the world is tileSize · 2^z pixels, so a fit whose world width is
  // exactly that must choose z — tiles drawn 1:1, neither up- nor downscaled.
  it('picks the zoom whose world width matches the fit exactly', () => {
    expect(tileZoomFor(256, 256, 19)).toBe(0)
    expect(tileZoomFor(256 * 2 ** 12, 256, 19)).toBe(12)
  })

  it('rounds to the nearer level rather than always magnifying', () => {
    // 1.5 · 2^10 tiles across: closer to z=11 (2×) than to z=10 (1×) in log
    // space, since the crossover is at √2.
    expect(tileZoomFor(256 * 1.5 * 2 ** 10, 256, 19)).toBe(11)
    expect(tileZoomFor(256 * 1.3 * 2 ** 10, 256, 19)).toBe(10)
  })

  it('never asks for a level the provider does not serve', () => {
    expect(tileZoomFor(256 * 2 ** 25, 256, 19)).toBe(19)
    expect(tileZoomFor(1, 256, 19)).toBe(0)
  })

  it('is total for a degenerate fit', () => {
    expect(tileZoomFor(0, 256, 19)).toBe(0)
    expect(tileZoomFor(NaN, 256, 19)).toBe(0)
    expect(tileZoomFor(1000, 0, 19)).toBe(0)
  })
})

describe('tilesCovering', () => {
  it('returns the single tile at zoom 0', () => {
    expect(tilesCovering({ x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }, 0)).toEqual([{ z: 0, x: 0, y: 0 }])
  })

  it('covers a rect spanning several tiles, row-major', () => {
    // At z=2 the grid is 4×4, each tile 0.25 wide. [0.3,0.6] spans columns 1-2,
    // [0.1,0.3] spans rows 0-1.
    expect(tilesCovering({ x0: 0.3, y0: 0.1, x1: 0.6, y1: 0.3 }, 2)).toEqual([
      { z: 2, x: 1, y: 0 },
      { z: 2, x: 2, y: 0 },
      { z: 2, x: 1, y: 1 },
      { z: 2, x: 2, y: 1 },
    ])
  })

  // A bound of exactly 1.0 floors to tile n, which every provider 404s. Real
  // routes reach it at the antimeridian and at the Mercator cutoff.
  it('never asks for tile n at the far edge of the world', () => {
    const tiles = tilesCovering({ x0: 0.99, y0: 0.99, x1: 1, y1: 1 }, 3)
    expect(tiles).toEqual([{ z: 3, x: 7, y: 7 }])
  })

  it('clamps a bound that fell off the near edge', () => {
    expect(tilesCovering({ x0: -0.2, y0: -0.5, x1: 0.1, y1: 0.1 }, 2)).toEqual([{ z: 2, x: 0, y: 0 }])
  })
})

describe('tileRect', () => {
  it('places a tile through the same fit the route uses', () => {
    const fit = { scale: 1024, offsetX: 10, offsetY: 20 }
    // z=2 → a 4×4 grid, so each tile is a quarter of the world: 256px here.
    expect(tileRect({ z: 2, x: 1, y: 3 }, fit)).toEqual({ x: 10 + 256, y: 20 + 768, size: 256 })
  })

  it('tiles a row edge to edge with no overlap in the arithmetic', () => {
    const fit = { scale: 400, offsetX: 0, offsetY: 0 }
    const a = tileRect({ z: 1, x: 0, y: 0 }, fit)
    const b = tileRect({ z: 1, x: 1, y: 0 }, fit)
    expect(a.x + a.size).toBeCloseTo(b.x, 9)
  })
})

describe('tileKey', () => {
  it('separates providers at the same coordinate', () => {
    expect(tileKey('standard', { z: 3, x: 1, y: 2 })).toBe('standard/3/1/2')
    expect(tileKey('satellite', { z: 3, x: 1, y: 2 })).not.toBe(tileKey('standard', { z: 3, x: 1, y: 2 }))
  })
})
