import { describe, it, expect } from 'vitest'
import { fitFor, viewBoundsOf } from './fitBounds.js'

const project = (fit, x, y) => ({ px: x * fit.scale + fit.offsetX, py: y * fit.scale + fit.offsetY })

describe('fitFor', () => {
  it('fits a square route to the binding axis and centres it on the other', () => {
    const fit = fitFor({ x0: 0, y0: 0, x1: 0.1, y1: 0.1 }, { width: 400, height: 200, padding: 10 })

    // Height binds: (200 - 20) / 0.1.
    expect(fit.scale).toBeCloseTo(1800, 9)
    const a = project(fit, 0, 0)
    const b = project(fit, 0.1, 0.1)
    expect(a.py).toBeCloseTo(10, 9)
    expect(b.py).toBeCloseTo(190, 9)
    // Centred horizontally in the space it did not need.
    expect(a.px + b.px).toBeCloseTo(400, 9)
  })

  it('uses ONE scale for both axes, so shape is preserved', () => {
    // A route twice as wide as tall must render twice as wide as tall, whatever
    // the panel's own aspect ratio. Two scales would fill the panel and lie
    // about the shape of the route — the distortion Mercator was chosen to
    // avoid in the first place.
    const fit = fitFor({ x0: 0, y0: 0, x1: 0.2, y1: 0.1 }, { width: 400, height: 400, padding: 0 })
    const a = project(fit, 0, 0)
    const b = project(fit, 0.2, 0.1)
    expect(b.px - a.px).toBeCloseTo(2 * (b.py - a.py), 9)
  })

  it('keeps the stroke off the edge by the padding', () => {
    const fit = fitFor({ x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 }, { width: 300, height: 300, padding: 12 })
    expect(project(fit, 0.2, 0.2).px).toBeCloseTo(12, 9)
    expect(project(fit, 0.4, 0.4).px).toBeCloseTo(288, 9)
  })

  it('centres a single fix rather than dividing by zero', () => {
    const fit = fitFor({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, { width: 400, height: 200 })
    expect(Number.isFinite(fit.scale)).toBe(true)
    expect(fit.scale).toBeGreaterThan(0)
    const { px, py } = project(fit, 0.5, 0.5)
    expect(px).toBeCloseTo(200, 9)
    expect(py).toBeCloseTo(100, 9)
  })

  it('lets the other axis decide the scale for a perfectly straight route', () => {
    // Due north-south: spanX is 0, so only the height can bind.
    const fit = fitFor({ x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.3 }, { width: 400, height: 200, padding: 0 })
    expect(fit.scale).toBeCloseTo(1000, 9)
    expect(project(fit, 0.5, 0.1).py).toBeCloseTo(0, 9)
    expect(project(fit, 0.5, 0.3).py).toBeCloseTo(200, 9)
  })

  it('never produces a negative scale on a panel smaller than its own padding', () => {
    // A negative scale mirrors the whole map about its centre.
    const fit = fitFor({ x0: 0, y0: 0, x1: 0.1, y1: 0.1 }, { width: 10, height: 10, padding: 8 })
    expect(fit.scale).toBeGreaterThan(0)
  })
})

describe('viewBoundsOf', () => {
  it('reports what is on screen, which is more than the route bbox', () => {
    const bounds = { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 }
    const fit = fitFor(bounds, { width: 300, height: 300, padding: 12 })
    const view = viewBoundsOf(fit, 300, 300)

    expect(view.x0).toBeLessThan(bounds.x0)
    expect(view.x1).toBeGreaterThan(bounds.x1)
    expect(view.y0).toBeLessThan(bounds.y0)
    expect(view.y1).toBeGreaterThan(bounds.y1)
  })

  it('inverts the transform exactly', () => {
    const fit = fitFor({ x0: 0.2, y0: 0.3, x1: 0.4, y1: 0.35 }, { width: 400, height: 200, padding: 0 })
    const view = viewBoundsOf(fit, 400, 200)
    expect(project(fit, view.x0, view.y0).px).toBeCloseTo(0, 6)
    expect(project(fit, view.x1, view.y1).py).toBeCloseTo(200, 6)
  })

  it('clamps to the world, since there are no tiles off the edge of it', () => {
    // A tiny route in the far north puts the canvas corners past y=0.
    const fit = fitFor({ x0: 0.5, y0: 0.001, x1: 0.5001, y1: 0.0011 }, { width: 400, height: 400 })
    const view = viewBoundsOf(fit, 400, 400)
    expect(view.y0).toBeGreaterThanOrEqual(0)
    expect(view.x1).toBeLessThanOrEqual(1)
  })
})
