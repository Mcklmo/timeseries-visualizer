import { describe, it, expect } from 'vitest'
import {
  CHART_MARGIN,
  clampFraction,
  fractionAcross,
  plotRectFromSurface,
  Y_AXIS_RIGHT_WIDTH,
  Y_AXIS_WIDTH,
} from './chartGeometry.js'

// Unit-tested rather than driven through a rendered ChartStack on purpose:
// setupTests.js hard-assigns getBoundingClientRect to return ONE fixed rect
// for every element in the document, so a rendered test gets the same numbers
// back whether the code measured the .recharts-surface or the stack around it.
// It cannot distinguish correct geometry from geometry that happens to be off
// by the stack's padding and border. Here the input is explicit, so the
// arithmetic is actually pinned.
describe('plotRectFromSurface', () => {
  it('insets by the y-axis and the chart margins', () => {
    // 100 + 56 + 4 = 160 from the left; 800 - 60 - 12 = 728 wide.
    expect(plotRectFromSurface({ left: 100, width: 800 })).toEqual({ left: 160, width: 728 })
  })

  it('agrees with the constants MetricPanel is laid out with', () => {
    // Restates the same expectation in terms of the exports, so a change to
    // either constant fails here rather than silently shifting every gesture
    // a few pixels off the line the user is touching.
    const { left, width } = plotRectFromSurface({ left: 0, width: 800 })
    expect(left).toBe(Y_AXIS_WIDTH + CHART_MARGIN.left)
    expect(width).toBe(800 - Y_AXIS_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right)
  })

  it('takes the derivative axis off the right edge, leaving the left one alone', () => {
    // The overlay axis is on the right, so it narrows the plot without moving
    // its origin — get this backwards and every gesture lands offset by 44px.
    expect(plotRectFromSurface({ left: 100, width: 800 }, Y_AXIS_RIGHT_WIDTH)).toEqual({
      left: 160,
      width: 728 - Y_AXIS_RIGHT_WIDTH,
    })
  })

  it('defaults rightInset to 0, so a stack with no overlay measures as it always did', () => {
    // MetricPanel and usePinchZoom both rely on this default: the no-derivative
    // render has to stay byte-identical to the pre-feature one.
    expect(plotRectFromSurface({ left: 100, width: 800 })).toEqual(
      plotRectFromSurface({ left: 100, width: 800 }, 0),
    )
  })

  it('returns null for a container too narrow to gesture in, never a negative width', () => {
    expect(plotRectFromSurface({ left: 0, width: 40 })).toBeNull()
    expect(plotRectFromSurface({ left: 0, width: 0 })).toBeNull()
    // The right axis is what can tip a very narrow viewport under the floor:
    // 110px of surface leaves 38px of plot on its own, and none once the
    // overlay axis claims its gutter. Null either way beats a negative width.
    expect(plotRectFromSurface({ left: 0, width: 110 })).not.toBeNull()
    expect(plotRectFromSurface({ left: 0, width: 110 }, Y_AXIS_RIGHT_WIDTH)).toBeNull()
  })

  it('is total: no rect, or a non-finite one, gives null', () => {
    expect(plotRectFromSurface(null)).toBeNull()
    expect(plotRectFromSurface({ left: NaN, width: 800 })).toBeNull()
    expect(plotRectFromSurface({ left: 0, width: NaN })).toBeNull()
  })
})

describe('fractionAcross', () => {
  const plotRect = { left: 60, width: 728 }

  it('is 0 at the left edge and 1 at the right', () => {
    expect(fractionAcross(60, plotRect)).toBe(0)
    expect(fractionAcross(788, plotRect)).toBe(1)
  })

  it('extrapolates past either edge rather than clamping', () => {
    // A finger on the y-axis strip is a real, meaningful negative fraction —
    // the anchored solve extrapolates it correctly and clampDomain fixes the
    // result. Clamping here would lie about where the finger is.
    expect(fractionAcross(0, plotRect)).toBeCloseTo(-60 / 728, 12)
    expect(fractionAcross(1000, plotRect)).toBeGreaterThan(1)
  })

  it('maps the eighth-fractions the chart tests use to their integer pixels', () => {
    // 728 = 8 × 91, which is why these land on whole numbers under the fixed
    // 800px rect from setupTests.js — see the pinch helpers in ChartStack.test.
    expect(fractionAcross(151, plotRect)).toBeCloseTo(0.125, 6)
    expect(fractionAcross(242, plotRect)).toBeCloseTo(0.25, 6)
    expect(fractionAcross(424, plotRect)).toBeCloseTo(0.5, 6)
    expect(fractionAcross(606, plotRect)).toBeCloseTo(0.75, 6)
    expect(fractionAcross(697, plotRect)).toBeCloseTo(0.875, 6)
  })

  it('is total on a degenerate rect', () => {
    expect(fractionAcross(100, { left: 0, width: 0 })).toBe(0)
    expect(fractionAcross(100, null)).toBe(0)
  })
})

describe('clampFraction', () => {
  it('clamps to [0,1]', () => {
    expect(clampFraction(-0.4)).toBe(0)
    expect(clampFraction(1.6)).toBe(1)
    expect(clampFraction(0.3)).toBe(0.3)
  })

  it('falls back to the plot centre for a non-finite input', () => {
    expect(clampFraction(NaN)).toBe(0.5)
  })
})
