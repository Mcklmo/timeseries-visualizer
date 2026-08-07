// All the arithmetic behind pinch-to-zoom. No React, no DOM, no pixels — the
// hook (ui/usePinchZoom.js) converts fingers into fractions across the plot
// and hands them here; everything about *what window we end up looking at*
// lives in this file, where it can be tested as plain functions.
//
// This is also the single definition of "unzoomed": zoomDomain (§10) is a
// Recharts domain, and its unzoomed value is the sentinel pair
// ['dataMin','dataMax'] rather than numbers. ChartViewContext, ChartStack,
// MetricPanel and the reset control all go through fullDomain()/isFullDomain()
// instead of writing that literal out, so there is one thing to change if the
// representation ever does.
//
// Every export here is total: garbage in yields a usable domain or null, never
// a throw and never NaN. The hook runs these on every animation frame of a
// live gesture, where a thrown error would leave the chart wedged mid-pinch.

/** The unzoomed x-domain. A factory, not a shared constant: the array goes
 *  straight into Recharts as a prop, and a shared one would be aliased into
 *  every panel where any mutation would leak everywhere.
 *  @returns {['dataMin', 'dataMax']} */
export function fullDomain() {
  return ['dataMin', 'dataMax']
}

/** True only for the exact sentinel pair. Total — null, short arrays and
 *  half-sentinels (['dataMin', 40]) are all false.
 *  @param {unknown} domain
 *  @returns {boolean} */
export function isFullDomain(domain) {
  return Array.isArray(domain) && domain.length === 2 && domain[0] === 'dataMin' && domain[1] === 'dataMax'
}

/**
 * The activity's true x-extent.
 *
 * Feed this `activity.samples`, NOT the rows MetricPanel builds with
 * insertGapBreaks — those carry synthetic midpoint rows, which by construction
 * sit *between* two real samples and so can never change the extent, but
 * relying on that is a trap waiting for the day a break lands at an edge.
 *
 * @param {{t?: number, d?: number}[]} samples
 * @param {'t'|'d'} xKey
 * @returns {[number, number] | null} null when nothing usable is present
 */
export function extentOf(samples, xKey) {
  if (!Array.isArray(samples)) return null
  let min = Infinity
  let max = -Infinity
  for (const sample of samples) {
    const x = sample?.[xKey]
    // Skips undefined/NaN rather than letting one poison both bounds —
    // Math.min(NaN, …) is NaN forever after.
    if (typeof x !== 'number' || !Number.isFinite(x)) continue
    if (x < min) min = x
    if (x > max) max = x
  }
  return min === Infinity ? null : [min, max]
}

/**
 * A zoomDomain in whatever state the app left it — sentinel, half-sentinel,
 * numbers, or garbage — as a plain numeric pair.
 *
 * Always returns a fresh array: callers hand the result to Recharts and to
 * clampDomain, and a returned reference to `fullExtent` would let either
 * corrupt the extent for everyone.
 *
 * @param {unknown} domain
 * @param {[number, number]} fullExtent
 * @returns {[number, number]}
 */
export function resolveDomain(domain, fullExtent) {
  const [fullMin, fullMax] = fullExtent
  if (!Array.isArray(domain) || domain.length !== 2) return [fullMin, fullMax]
  const start = typeof domain[0] === 'number' && Number.isFinite(domain[0]) ? domain[0] : fullMin
  const end = typeof domain[1] === 'number' && Number.isFinite(domain[1]) ? domain[1] : fullMax
  return start <= end ? [start, end] : [end, start]
}

/** Value at a fraction across a domain. Deliberately unclamped: a finger can
 *  land on the y-axis strip, which is a negative fraction, and extrapolating
 *  there is the honest answer — clamping would lie about where the finger is
 *  and make the anchor drift out from under it.
 *  @param {number} fraction
 *  @param {[number, number]} domain
 *  @returns {number} */
export function valueAtFraction(fraction, domain) {
  return domain[0] + fraction * (domain[1] - domain[0])
}

/** Inverse of valueAtFraction, equally unclamped. A zero-width domain has no
 *  meaningful fraction, so it answers 0 rather than ±Infinity/NaN.
 *  @param {number} value
 *  @param {[number, number]} domain
 *  @returns {number} */
export function fractionOfValue(value, domain) {
  const span = domain[1] - domain[0]
  if (span === 0) return 0
  return (value - domain[0]) / span
}

// Two fingers less than this far apart (as a fraction of plot width) can't
// specify a window: the solve divides by their separation, so a near-zero
// denominator turns finger tremor into enormous jumps in span.
const MIN_FRACTION_SEPARATION = 0.02

/** How far in the deepest pinch can go, as a multiple of the full span. */
export const MAX_ZOOM = 50

/**
 * The two-pointer anchored solve — the heart of the gesture.
 *
 * Each pointer carries the x `value` that sat under it when the gesture
 * started, plus its live `fraction` across the plot. The window we want is the
 * one that puts both values back under both fingers, i.e. solving
 * `start + f·width = value` for both pointers at once:
 *
 *   width = (b.value - a.value) / (b.fraction - a.fraction)
 *   start = a.value - a.fraction · width
 *
 * Two-finger *pan* falls out of this for free and is not a separate gesture:
 * shift both fractions by δ and the denominator is unchanged, so `width` is
 * bit-identical and the window simply translates by −δ·width. Panning and
 * zooming therefore compose continuously within one gesture. There is a unit
 * test pinning this so nobody "simplifies" it away.
 *
 * @param {{value: number, fraction: number}} a - pointer with the lower start fraction
 * @param {{value: number, fraction: number}} b
 * @returns {[number, number] | null} null for any frame that can't specify a window
 */
export function solveAnchoredDomain(a, b) {
  if (!a || !b) return null
  if (![a.value, a.fraction, b.value, b.fraction].every(Number.isFinite)) return null

  // SIGNED, not absolute. Pointers arrive ordered by their *start* fraction,
  // so crossed fingers give a negative df. Returning null there (rather than
  // swapping them) means the hook keeps holding the last good domain instead
  // of flipping the chart inside out mid-gesture.
  const df = b.fraction - a.fraction
  if (df < MIN_FRACTION_SEPARATION) return null

  const width = (b.value - a.value) / df
  if (!Number.isFinite(width) || width <= 0) return null

  const start = a.value - a.fraction * width
  if (!Number.isFinite(start)) return null
  return [start, start + width]
}

/**
 * The narrowest window we'll allow, as a fraction of the full span.
 *
 * NOT a sample count, and deliberately not derived from samplingIntervalS:
 * that is *seconds*, while a distance-mode domain is *metres*, so a
 * sample-based floor gives a 10 m window on a 47 km ride (a 4700× zoom) and,
 * on a sparse multi-day track, a floor wider than the activity itself — an
 * activity that cannot be zoomed at all. A fraction of the full span is
 * unit-agnostic and bounds the quantity actually being limited, magnification,
 * identically in both x-modes.
 *
 * @param {number} fullSpan
 * @param {number} maxZoom
 * @returns {number}
 */
export function minSpanFor(fullSpan, maxZoom = MAX_ZOOM) {
  if (!Number.isFinite(fullSpan) || fullSpan <= 0) return 0
  if (!Number.isFinite(maxZoom) || maxZoom <= 0) return 0
  return fullSpan / maxZoom
}

/**
 * Force a solved window back inside what's real: no narrower than `minSpan`,
 * no wider than the extent, and not hanging off either end.
 *
 * @param {[number, number]} domain
 * @param {[number, number]} fullExtent
 * @param {{minSpan?: number, anchorFraction?: number}} [opts] anchorFraction is
 *   the pinch centre — where in the window to hold still if the span has to
 *   change out from under the user.
 * @returns {[number, number]}
 */
export function clampDomain(domain, fullExtent, { minSpan = 0, anchorFraction = 0.5 } = {}) {
  const [fullMin, fullMax] = fullExtent
  const fullSpan = fullMax - fullMin
  if (!Number.isFinite(fullSpan) || fullSpan <= 0) return [fullMin, fullMax]

  let [start, end] = resolveDomain(domain, fullExtent)
  let span = end - start

  // Order matters: minSpan first, then fullSpan, so fullSpan wins on an
  // activity shorter than the floor rather than the two fighting.
  const floor = Number.isFinite(minSpan) && minSpan > 0 ? Math.min(minSpan, fullSpan) : 0
  if (span < floor) span = floor
  if (span > fullSpan) span = fullSpan

  if (span !== end - start) {
    // Re-anchor about the pinch centre instead of pinning `start`. Pinning it
    // makes the window visibly walk leftward on every frame the user keeps
    // pushing past the limit, which reads as the chart drifting under a
    // stationary finger.
    const anchorValue = valueAtFraction(anchorFraction, [start, end])
    start = anchorValue - anchorFraction * span
  }

  // Translate, preserving width — never truncate. A window straddling an edge
  // should slide fully into view at the size the user asked for, not shrink.
  if (start < fullMin) start = fullMin
  if (start + span > fullMax) start = fullMax - span
  if (start < fullMin) start = fullMin

  return [start, start + span]
}

/**
 * Restore the sentinel once the window is (near enough) the whole activity, so
 * "unzoomed" has exactly one representation no matter how the user got back
 * there — float arithmetic will never land on the extent exactly.
 *
 * @param {[number, number]} domain
 * @param {[number, number]} fullExtent
 * @param {number} [eps] tolerance as a fraction of the full span
 * @returns {[number, number] | ['dataMin', 'dataMax']}
 */
export function snapToFull(domain, fullExtent, eps = 1e-6) {
  const [fullMin, fullMax] = fullExtent
  const fullSpan = fullMax - fullMin
  if (!Number.isFinite(fullSpan) || fullSpan <= 0) return fullDomain()
  const tolerance = fullSpan * eps
  // BOTH edges, not either: a window pinned to the left edge but zoomed in on
  // the right is a real zoom state and must stay numeric.
  if (Math.abs(domain[0] - fullMin) <= tolerance && Math.abs(domain[1] - fullMax) <= tolerance) {
    return fullDomain()
  }
  return domain
}

/**
 * solve → clamp → snap. What the pinch path calls once per animation frame.
 *
 * @param {{value: number, fraction: number}} a
 * @param {{value: number, fraction: number}} b
 * @param {[number, number]} fullExtent
 * @param {{maxZoom?: number}} [opts]
 * @returns {[number, number] | ['dataMin', 'dataMax'] | null}
 */
export function pinchDomain(a, b, fullExtent, { maxZoom = MAX_ZOOM } = {}) {
  const solved = solveAnchoredDomain(a, b)
  if (solved === null) return null
  const fullSpan = fullExtent[1] - fullExtent[0]
  const clamped = clampDomain(solved, fullExtent, {
    minSpan: minSpanFor(fullSpan, maxZoom),
    anchorFraction: (a.fraction + b.fraction) / 2,
  })
  return snapToFull(clamped, fullExtent)
}

/**
 * Single-anchor variant: hold the value at `fraction` still and scale the span
 * by `scale` about it. What the ctrl/⌘+wheel path calls.
 *
 * @param {unknown} domain - current zoomDomain, sentinel or numeric
 * @param {[number, number]} fullExtent
 * @param {number} fraction - where the cursor sits across the plot
 * @param {number} scale - <1 zooms in, >1 zooms out
 * @param {{maxZoom?: number}} [opts]
 * @returns {[number, number] | ['dataMin', 'dataMax'] | null}
 */
export function zoomAtFraction(domain, fullExtent, fraction, scale, { maxZoom = MAX_ZOOM } = {}) {
  if (!Number.isFinite(fraction) || !Number.isFinite(scale) || scale <= 0) return null
  const current = resolveDomain(domain, fullExtent)
  const anchorValue = valueAtFraction(fraction, current)
  const span = (current[1] - current[0]) * scale
  if (!Number.isFinite(span) || span <= 0) return null

  const start = anchorValue - fraction * span
  const fullSpan = fullExtent[1] - fullExtent[0]
  const clamped = clampDomain([start, start + span], fullExtent, {
    minSpan: minSpanFor(fullSpan, maxZoom),
    anchorFraction: fraction,
  })
  return snapToFull(clamped, fullExtent)
}
