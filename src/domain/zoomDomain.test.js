import { describe, it, expect } from 'vitest'
import {
  CONTEXT_MARGIN,
  clampDomain,
  extentOf,
  fractionOfValue,
  fullDomain,
  isFullDomain,
  minSpanFor,
  moveWindowEdge,
  panByFraction,
  resolveDomain,
  sameDomain,
  snapToFull,
  toWindowDelta,
  valueAtFraction,
  viewDomainFor,
  windowFractions,
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

describe('sameDomain', () => {
  it('holds for the sentinel pair, which is a fresh array every time', () => {
    expect(sameDomain(fullDomain(), fullDomain())).toBe(true)
  })

  it('compares numeric pairs element-wise rather than by reference', () => {
    expect(sameDomain([10, 20], [10, 20])).toBe(true)
    expect(sameDomain([10, 20], [10, 21])).toBe(false)
  })

  it('never says two different KINDS of domain are the same', () => {
    expect(sameDomain(fullDomain(), [0, 100])).toBe(false)
  })

  it('is total: null and non-arrays are just not equal to anything but themselves', () => {
    expect(sameDomain(null, null)).toBe(true)
    expect(sameDomain([10, 20], null)).toBe(false)
    expect(sameDomain(undefined, [10, 20])).toBe(false)
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

describe('panByFraction', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('translates the window without changing its width at all', () => {
    const result = panByFraction([20, 60], extent, 0.25)
    // Exact, not toBeCloseTo: a pan that loses width by a rounding error would
    // creep the zoom level on every event of a momentum swipe.
    expect(result[1] - result[0]).toBe(40)
    expect(result).toEqual([30, 70])
  })

  it('scales the delta by the CURRENT span, so travel stays 1:1 at every zoom', () => {
    // Same quarter-of-the-plot gesture, a window a tenth as wide: the content
    // must move a tenth as far, not the same distance.
    const result = panByFraction([20, 24], extent, 0.25)
    expect(result).toEqual([21, 25])
  })

  it('moves forward on a positive delta and backward on a negative one', () => {
    expect(panByFraction([20, 60], extent, 0.5)[0]).toBeGreaterThan(20)
    expect(panByFraction([20, 60], extent, -0.5)[0]).toBeLessThan(20)
  })

  it('pins to the right edge AT FULL WIDTH rather than truncating against it', () => {
    // The property that would break if clampDomain ever truncated instead of
    // translating: overshooting the end must still show a 40-wide window.
    const result = panByFraction([50, 90], extent, 1)
    expect(result).toEqual([60, 100])
    expect(result[1] - result[0]).toBe(40)
  })

  it('pins to the left edge at full width too', () => {
    const result = panByFraction([10, 50], extent, -1)
    expect(result).toEqual([0, 40])
    expect(result[1] - result[0]).toBe(40)
  })

  it('is a self-cancelling no-op at full zoom, returning the sentinel', () => {
    // There is nowhere to pan to, so the clamp slides it straight back and
    // snapToFull restores the one representation of "unzoomed". The hook's
    // emit dedupe swallows the result, which is why no special case is needed.
    expect(isFullDomain(panByFraction(fullDomain(), extent, 0.25))).toBe(true)
  })

  it('is total: a non-finite or zero delta gives null', () => {
    expect(panByFraction([20, 60], extent, NaN)).toBeNull()
    expect(panByFraction([20, 60], extent, Infinity)).toBeNull()
    expect(panByFraction([20, 60], extent, 0)).toBeNull()
  })
})

describe('viewDomainFor', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('pads the window by CONTEXT_MARGIN of its own span on each side', () => {
    // 40-wide window → 10 of shoulder each side at the default 0.25.
    expect(viewDomainFor([40, 80], extent)).toEqual([30, 90])
    expect(CONTEXT_MARGIN).toBe(0.25)
  })

  it('clamps against the extent, so a shoulder exists only where data does', () => {
    // Pinned to the start: no left shoulder at all, full right shoulder.
    expect(viewDomainFor([0, 40], extent)).toEqual([0, 50])
    expect(viewDomainFor([60, 100], extent)).toEqual([50, 100])
  })

  it('passes the sentinel straight through, so unzoomed plots exactly what it did', () => {
    expect(isFullDomain(viewDomainFor(fullDomain(), extent))).toBe(true)
  })

  it('returns the sentinel once the padded view covers the whole activity', () => {
    // A window nearly the full width pads out past both edges; snapToFull is
    // what keeps "unzoomed" to one representation and hides the reset control.
    expect(isFullDomain(viewDomainFor([1, 99], extent))).toBe(true)
  })

  it('is total: no extent, a garbage extent or a garbage margin all yield something usable', () => {
    expect(isFullDomain(viewDomainFor([10, 20], null))).toBe(true)
    expect(isFullDomain(viewDomainFor([10, 20], [5, 5]))).toBe(true)
    expect(isFullDomain(viewDomainFor([10, 20], [NaN, 100]))).toBe(true)
    // A garbage margin degrades to no padding rather than to NaN bounds.
    expect(viewDomainFor([40, 80], extent, NaN)).toEqual([40, 80])
  })
})

describe('windowFractions', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])

  it('reports where the window sits across the plotted view', () => {
    // Window [40,80] inside view [30,90]: 10/60 and 50/60.
    const [f0, f1] = windowFractions([40, 80], [30, 90], extent)
    expect(f0).toBeCloseTo(1 / 6, 9)
    expect(f1).toBeCloseTo(5 / 6, 9)
  })

  it('agrees with viewDomainFor: an unclamped window always sits at 1/6 … 5/6', () => {
    // The property §2.2's runaway argument depends on — the handles are at a
    // FIXED plot fraction whenever the shoulders are unclamped, which is why
    // the view has to be frozen during a drag.
    const win = /** @type {[number, number]} */ ([40, 80])
    const [f0, f1] = windowFractions(win, viewDomainFor(win, extent), extent)
    expect(f0).toBeCloseTo(1 / 6, 9)
    expect(f1).toBeCloseTo(5 / 6, 9)
  })

  it('is asymmetric when a shoulder is clamped away', () => {
    const win = /** @type {[number, number]} */ ([0, 40])
    expect(windowFractions(win, viewDomainFor(win, extent), extent)).toEqual([0, 0.8])
  })

  it('resolves a SENTINEL view rather than short-circuiting on it', () => {
    // A reachable state, not a curiosity: a window wider than ⅔ of the activity
    // pads out past both ends, so snapToFull hands back the sentinel view while
    // the window inside it is still a real zoom with shoulders to draw. Short-
    // circuiting here would park both handles on the plot edges while the Reset
    // control was still on screen.
    expect(windowFractions([10, 90], fullDomain(), extent)).toEqual([0.1, 0.9])
  })

  it('is [0, 1] whenever there is no zoom to describe', () => {
    expect(windowFractions(fullDomain(), fullDomain(), extent)).toEqual([0, 1])
    expect(windowFractions(fullDomain(), [30, 90], extent)).toEqual([0, 1])
    expect(windowFractions([40, 80], [30, 90], null)).toEqual([0, 1])
    expect(windowFractions([40, 80], [50, 50], extent)).toEqual([0, 1])
  })
})

describe('toWindowDelta', () => {
  it('scales travel by the window\'s share of the plot, so a swipe stays 1:1', () => {
    // An eighth of the plot is an eighth of the VIEW, which is 3/16 of a window
    // occupying ⅔ of it — panByFraction multiplies by the window's span, so it
    // has to be handed the larger number.
    expect(toWindowDelta(0.125, [1 / 6, 5 / 6])).toBeCloseTo(0.1875, 9)
  })

  it('has no offset term, unlike toWindowFraction — a translation has no origin', () => {
    expect(toWindowDelta(0, [1 / 6, 5 / 6])).toBe(0)
    expect(toWindowDelta(-0.125, [1 / 6, 5 / 6])).toBeCloseTo(-0.1875, 9)
  })

  it('is the identity when unzoomed, and total otherwise', () => {
    expect(toWindowDelta(0.125, [0, 1])).toBe(0.125)
    expect(toWindowDelta(0.125, [0.5, 0.5])).toBe(0.125)
    expect(toWindowDelta(0.125, null)).toBe(0.125)
  })
})

describe('moveWindowEdge', () => {
  const extent = /** @type {[number, number]} */ ([0, 100])
  const view = /** @type {[number, number]} */ ([30, 90])

  it('moves the named edge and leaves the other one exactly where it was', () => {
    expect(moveWindowEdge([40, 80], 'start', 50, view, extent)).toEqual([50, 80])
    expect(moveWindowEdge([40, 80], 'end', 70, view, extent)).toEqual([40, 70])
  })

  it('clamps into the VIEW, not the extent — the handle cannot leave the plot', () => {
    expect(moveWindowEdge([40, 80], 'start', 0, view, extent)).toEqual([30, 80])
    expect(moveWindowEdge([40, 80], 'end', 200, view, extent)).toEqual([40, 90])
  })

  it('holds the min-span floor instead of letting the edges cross', () => {
    const minSpan = minSpanFor(100)
    // Dragging start past end stops one floor short of it, both ways.
    expect(moveWindowEdge([40, 80], 'start', 95, view, extent, { minSpan })).toEqual([80 - minSpan, 80])
    expect(moveWindowEdge([40, 80], 'end', 10, view, extent, { minSpan })).toEqual([40, 40 + minSpan])
  })

  it('snaps back to the sentinel when an edge is dragged out to the full extent', () => {
    // Which is how the Reset control disappears — by the rule it already
    // follows, rather than by a rule of this function's own.
    expect(isFullDomain(moveWindowEdge([0, 60], 'end', 100, extent, extent))).toBe(true)
    expect(isFullDomain(moveWindowEdge([40, 100], 'start', 0, extent, extent))).toBe(true)
  })

  it('treats a sentinel window as the whole extent, so a first drag works', () => {
    // Unzoomed, both handles are parked on the plot edges; dragging one is how
    // a trim is started.
    expect(moveWindowEdge(fullDomain(), 'start', 25, fullDomain(), extent)).toEqual([25, 100])
  })

  it('is total: no extent, a degenerate view or a non-finite value never throws or yields NaN', () => {
    expect(isFullDomain(moveWindowEdge([40, 80], 'start', 50, view, null))).toBe(true)
    expect(moveWindowEdge([40, 80], 'start', NaN, view, extent)).toEqual([40, 80])
    expect(moveWindowEdge([40, 80], 'start', 50, [50, 50], extent)).toEqual([40, 80])
    expect(moveWindowEdge([40, 80], 'start', 50, view, extent, { minSpan: NaN })).toEqual([50, 80])
  })
})
