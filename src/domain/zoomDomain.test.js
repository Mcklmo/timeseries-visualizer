import { describe, it, expect } from 'vitest'
import {
  clampDomain,
  extentOf,
  fractionOfValue,
  fullDomain,
  isFullDomain,
  minSpanFor,
  pinchDomain,
  resolveDomain,
  snapToFull,
  solveAnchoredDomain,
  valueAtFraction,
  zoomAtFraction,
} from './zoomDomain.js'

describe('fullDomain / isFullDomain', () => {
  it('is the Recharts sentinel pair', () => {
    expect(fullDomain()).toEqual(['dataMin', 'dataMax'])
  })

  it('returns a fresh array each call, so panels can never alias one another', () => {
    expect(fullDomain()).not.toBe(fullDomain())
  })

  it('recognises the sentinel and nothing else', () => {
    expect(isFullDomain(fullDomain())).toBe(true)
    expect(isFullDomain([0, 40])).toBe(false)
    // A half-sentinel is a real zoom state (one edge pinned, one moved), so it
    // must not read as "unzoomed" — that would hide the reset control.
    expect(isFullDomain(['dataMin', 40])).toBe(false)
    expect(isFullDomain([0, 'dataMax'])).toBe(false)
  })

  it('is total: no input throws', () => {
    expect(isFullDomain(null)).toBe(false)
    expect(isFullDomain(undefined)).toBe(false)
    expect(isFullDomain([])).toBe(false)
    expect(isFullDomain(['dataMin'])).toBe(false)
    expect(isFullDomain('dataMin')).toBe(false)
  })
})

describe('extentOf', () => {
  const samples = [
    { t: 0, d: 0 },
    { t: 10, d: 50 },
    { t: 20, d: 100 },
    { t: 40, d: 200 },
  ]

  it('spans the first and last x of ascending samples, in either mode', () => {
    expect(extentOf(samples, 't')).toEqual([0, 40])
    expect(extentOf(samples, 'd')).toEqual([0, 200])
  })

  // Pins the "feed it activity.samples, not the chart rows" contract from the
  // module header: insertGapBreaks' synthetic rows are interior midpoints, so
  // an extent computed over them is the same — but only by construction, and
  // this is the assertion that would catch it changing.
  it('is unchanged by a synthetic insertGapBreaks row', () => {
    const withBreak = [...samples.slice(0, 3), { t: 30, d: 150, heartRate: null }, samples[3]]
    expect(extentOf(withBreak, 't')).toEqual([0, 40])
  })

  it('handles an all-zero axis without collapsing to null', () => {
    expect(extentOf([{ d: 0 }, { d: 0 }], 'd')).toEqual([0, 0])
  })

  it('returns null when there is nothing to measure', () => {
    expect(extentOf([], 't')).toBeNull()
    expect(extentOf(null, 't')).toBeNull()
    expect(extentOf([{ d: 5 }], 't')).toBeNull()
  })

  it('skips NaN and missing values instead of letting one poison both bounds', () => {
    const dirty = [{ t: 0 }, { t: NaN }, { t: undefined }, { t: 30 }]
    expect(extentOf(dirty, 't')).toEqual([0, 30])
  })
})

describe('resolveDomain', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('turns the sentinel into the full extent', () => {
    expect(resolveDomain(fullDomain(), extent)).toEqual([0, 100])
  })

  it('returns a copy, so mutating the result cannot corrupt the extent', () => {
    const resolved = resolveDomain(fullDomain(), extent)
    resolved[0] = 999
    expect(extent).toEqual([0, 100])
  })

  it('fills in only the sentinel half of a half-sentinel', () => {
    expect(resolveDomain(['dataMin', 25], extent)).toEqual([0, 25])
    expect(resolveDomain([25, 'dataMax'], extent)).toEqual([25, 100])
  })

  it('falls back to the extent for non-finite bounds', () => {
    expect(resolveDomain([NaN, 25], extent)).toEqual([0, 25])
    expect(resolveDomain([Infinity, Infinity], extent)).toEqual([0, 100])
    expect(resolveDomain(null, extent)).toEqual([0, 100])
    expect(resolveDomain([1, 2, 3], extent)).toEqual([0, 100])
  })

  it('normalises a reversed pair rather than propagating a negative span', () => {
    expect(resolveDomain([40, 0], extent)).toEqual([0, 40])
  })
})

describe('valueAtFraction / fractionOfValue', () => {
  const domain = /** @type {[number, number]} */ ([20, 60])

  it('round-trips across the window', () => {
    for (const f of [0, 0.25, 1]) {
      expect(fractionOfValue(valueAtFraction(f, domain), domain)).toBeCloseTo(f, 12)
    }
  })

  it('extrapolates outside [0,1] rather than clamping', () => {
    // A finger parked on the y-axis strip is a negative fraction, and the
    // honest answer is a value below the window — clamping would make the
    // anchor drift out from under it.
    expect(valueAtFraction(-0.1, [0, 100])).toBeCloseTo(-10, 12)
    expect(valueAtFraction(1.2, [0, 100])).toBeCloseTo(120, 12)
  })

  it('answers 0 for a zero-width domain instead of NaN or Infinity', () => {
    expect(fractionOfValue(5, [5, 5])).toBe(0)
    expect(Number.isFinite(fractionOfValue(9, [5, 5]))).toBe(true)
  })
})

describe('solveAnchoredDomain', () => {
  // THIS is the specification of the gesture: whatever window comes back must
  // put both captured values back under both fingers. Every other property of
  // zooming follows from it.
  it('puts both anchored values back under their fingers (anchor invariance)', () => {
    const cases = [
      { f1: 0.25, f2: 0.75, f1b: 0.125, f2b: 0.875 }, // pinch out
      { f1: 0.25, f2: 0.75, f1b: 0.4, f2b: 0.6 }, // pinch in
      { f1: 0.1, f2: 0.9, f1b: 0.3, f2b: 0.95 }, // asymmetric
      { f1: 0.25, f2: 0.75, f1b: 0.375, f2b: 0.875 }, // pure translation
    ]
    const start = /** @type {[number, number]} */ ([0, 100])

    for (const { f1, f2, f1b, f2b } of cases) {
      const v1 = valueAtFraction(f1, start)
      const v2 = valueAtFraction(f2, start)
      const result = solveAnchoredDomain({ value: v1, fraction: f1b }, { value: v2, fraction: f2b })
      expect(result).not.toBeNull()
      expect(valueAtFraction(f1b, result)).toBeCloseTo(v1, 9)
      expect(valueAtFraction(f2b, result)).toBeCloseTo(v2, 9)
    }
  })

  it('narrows the window when the fingers spread apart', () => {
    const result = solveAnchoredDomain({ value: 25, fraction: 0.125 }, { value: 75, fraction: 0.875 })
    expect(result[1] - result[0]).toBeLessThan(100)
  })

  it('widens the window when the fingers come together', () => {
    const result = solveAnchoredDomain({ value: 25, fraction: 0.4 }, { value: 75, fraction: 0.6 })
    expect(result[1] - result[0]).toBeGreaterThan(100)
  })

  // Documents the §B1 decision that two-finger pan is not a separate gesture:
  // it is what this solve already does when both fractions shift together.
  // Deleting the property would not fail any other test here, so it gets one
  // of its own.
  it('pans for free: shifting both fingers equally translates the window at identical width', () => {
    const domain = /** @type {[number, number]} */ ([20, 60])
    const f1 = 0.25
    const f2 = 0.75
    const shift = 0.125
    const result = solveAnchoredDomain(
      { value: valueAtFraction(f1, domain), fraction: f1 + shift },
      { value: valueAtFraction(f2, domain), fraction: f2 + shift },
    )
    expect(result[1] - result[0]).toBeCloseTo(40, 9) // width bit-identical
    expect(result[0]).toBeCloseTo(15, 9)
    expect(result[1]).toBeCloseTo(55, 9)
  })

  it('returns null for crossed fingers rather than flipping the chart inside out', () => {
    // Signed separation: the pointers are ordered by their START fraction, so
    // dragging them past each other gives a negative df. Holding the last good
    // domain beats inverting the axis mid-gesture.
    expect(solveAnchoredDomain({ value: 25, fraction: 0.8 }, { value: 75, fraction: 0.2 })).toBeNull()
  })

  it('returns null for coincident or near-coincident fingers instead of Infinity', () => {
    expect(solveAnchoredDomain({ value: 25, fraction: 0.5 }, { value: 75, fraction: 0.5 })).toBeNull()
    expect(solveAnchoredDomain({ value: 25, fraction: 0.5 }, { value: 75, fraction: 0.51 })).toBeNull()
  })

  it('returns null when a value would give a non-positive width', () => {
    expect(solveAnchoredDomain({ value: 75, fraction: 0.25 }, { value: 25, fraction: 0.75 })).toBeNull()
  })

  it('is total: any NaN or missing pointer gives null, never a throw', () => {
    expect(solveAnchoredDomain({ value: NaN, fraction: 0.25 }, { value: 75, fraction: 0.75 })).toBeNull()
    expect(solveAnchoredDomain({ value: 25, fraction: NaN }, { value: 75, fraction: 0.75 })).toBeNull()
    expect(solveAnchoredDomain(null, { value: 75, fraction: 0.75 })).toBeNull()
    expect(solveAnchoredDomain(undefined, undefined)).toBeNull()
  })
})

describe('minSpanFor', () => {
  it('is the full span divided by the zoom ceiling', () => {
    expect(minSpanFor(3600, 50)).toBe(72)
  })

  it('is unit-agnostic: the same fraction in metres as in seconds', () => {
    expect(minSpanFor(47000, 50)).toBe(940)
  })

  it('degrades to 0 rather than NaN on a degenerate span', () => {
    expect(minSpanFor(0, 50)).toBe(0)
    expect(minSpanFor(-10, 50)).toBe(0)
    expect(minSpanFor(NaN, 50)).toBe(0)
    expect(minSpanFor(3600, 0)).toBe(0)
  })
})

describe('clampDomain', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('pins a window wider than the extent to exactly the extent', () => {
    expect(clampDomain([-50, 300], extent)).toEqual([0, 100])
  })

  it('slides a window straddling an edge inside, preserving its width', () => {
    // Truncating to [0,20] would silently shrink the window the user asked
    // for; sliding keeps the magnification they set.
    expect(clampDomain([-10, 20], extent)).toEqual([0, 30])
    expect(clampDomain([90, 120], extent)).toEqual([70, 100])
  })

  it('enforces minSpan about the anchor: 0.5 holds the midpoint still', () => {
    const result = clampDomain([49, 51], extent, { minSpan: 10, anchorFraction: 0.5 })
    expect(result[1] - result[0]).toBeCloseTo(10, 9)
    expect((result[0] + result[1]) / 2).toBeCloseTo(50, 9)
  })

  it('enforces minSpan about the anchor: 0 holds the start still', () => {
    const result = clampDomain([40, 42], extent, { minSpan: 10, anchorFraction: 0 })
    expect(result).toEqual([40, 50])
  })

  it('lets fullSpan win when the floor is wider than the activity itself', () => {
    // Order matters — minSpan is clamped first, then fullSpan, so a
    // pathological floor can never produce a window wider than the data.
    expect(clampDomain([2, 3], extent, { minSpan: 500 })).toEqual([0, 100])
  })

  it('returns the extent, not NaN, for a zero-width extent', () => {
    expect(clampDomain([5, 5], [5, 5])).toEqual([5, 5])
    expect(clampDomain([0, 10], [5, 5])).toEqual([5, 5])
  })
})

describe('snapToFull', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('restores the sentinel for an exactly-full window', () => {
    expect(snapToFull([0, 100], extent)).toEqual(fullDomain())
  })

  it('restores the sentinel through float overshoot', () => {
    expect(snapToFull([-1e-12, 100 + 1e-12], extent)).toEqual(fullDomain())
  })

  it('keeps a window numeric when only ONE edge is at the extent', () => {
    // Pinned left, zoomed right — a real zoom state, and the reset control
    // must stay visible for it.
    expect(snapToFull([0, 60], extent)).toEqual([0, 60])
    expect(snapToFull([40, 100], extent)).toEqual([40, 100])
  })

  it('is total on a degenerate extent', () => {
    expect(snapToFull([5, 5], [5, 5])).toEqual(fullDomain())
  })
})

describe('pinchDomain', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('snaps back to the sentinel when pinched out past the full extent', () => {
    // Pinching OUT is fingers coming together while holding values far apart:
    // 80 units of data squeezed into a tenth of the plot implies a 800-wide
    // window. Proves snap composes after clamp — the solve overshoots, clamp
    // pins it to the extent, and snap turns that back into "unzoomed".
    const result = pinchDomain({ value: 10, fraction: 0.45 }, { value: 90, fraction: 0.55 }, extent)
    expect(result).toEqual(fullDomain())
  })

  it('stops at the max-zoom floor when pinched in past it', () => {
    const result = pinchDomain({ value: 49.9, fraction: 0.01 }, { value: 50.1, fraction: 0.99 }, extent)
    expect(result[1] - result[0]).toBeCloseTo(minSpanFor(100), 9)
  })

  it('produces a real intermediate zoom that keeps both anchors under both fingers', () => {
    const result = pinchDomain({ value: 25, fraction: 0.125 }, { value: 75, fraction: 0.875 }, extent)
    expect(valueAtFraction(0.125, result)).toBeCloseTo(25, 6)
    expect(valueAtFraction(0.875, result)).toBeCloseTo(75, 6)
  })

  it('passes null straight through for an unusable frame', () => {
    expect(pinchDomain({ value: 25, fraction: 0.8 }, { value: 75, fraction: 0.2 }, extent)).toBeNull()
  })
})

describe('zoomAtFraction', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('holds the left edge still at fraction 0', () => {
    expect(zoomAtFraction([0, 40], extent, 0, 0.5)).toEqual([0, 20])
  })

  it('holds the right edge still at fraction 1', () => {
    expect(zoomAtFraction([20, 60], extent, 1, 0.5)).toEqual([40, 60])
  })

  it('holds the midpoint still at fraction 0.5', () => {
    const result = zoomAtFraction([20, 60], extent, 0.5, 0.5)
    expect((result[0] + result[1]) / 2).toBeCloseTo(40, 9)
    expect(result[1] - result[0]).toBeCloseTo(20, 9)
  })

  it('zooms out from the sentinel without needing it resolved first', () => {
    expect(zoomAtFraction(fullDomain(), extent, 0.5, 0.5)).toEqual([25, 75])
  })

  it('widens without snapping while the result still fits inside the extent', () => {
    expect(zoomAtFraction([40, 60], extent, 0.5, 4)).toEqual([10, 90])
  })

  it('clamps to the extent AND returns the sentinel when zoomed out past full', () => {
    // 20 × 8 = 160, wider than the 100-unit activity.
    expect(zoomAtFraction([40, 60], extent, 0.5, 8)).toEqual(fullDomain())
  })

  it('respects the max-zoom floor', () => {
    const result = zoomAtFraction([49, 51], extent, 0.5, 0.1)
    expect(result[1] - result[0]).toBeCloseTo(minSpanFor(100), 9)
  })

  it('is total: a non-finite fraction or scale gives null', () => {
    expect(zoomAtFraction([0, 40], extent, NaN, 0.5)).toBeNull()
    expect(zoomAtFraction([0, 40], extent, 0.5, NaN)).toBeNull()
    expect(zoomAtFraction([0, 40], extent, 0.5, 0)).toBeNull()
  })
})
