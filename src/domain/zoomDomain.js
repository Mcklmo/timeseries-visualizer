// All the arithmetic behind the zoom window. No React, no DOM, no pixels — the
// hooks (ui/useEdgeDrag.js for the drag that zooms, ui/useWheelPan.js for the
// sideways pan) convert pointers into fractions across the plot and hand them
// here; everything about *what window we end up looking at* lives in this file,
// where it can be tested as plain functions.
//
// This module used to carry a two-pointer anchored solve as well, for the pinch
// and ctrl/⌘+wheel gestures. Those were deleted, along with everything only they
// used; ui/useWheelPan.js's header records why.
//
// This is also the single definition of "unzoomed": zoomDomain (§10) is a
// Recharts domain, and its unzoomed value is the sentinel pair
// ['dataMin','dataMax'] rather than numbers. ChartViewContext, ChartStack,
// MetricPanel and the reset control all go through fullDomain()/isFullDomain()
// instead of writing that literal out, so there is one thing to change if the
// representation ever does.
//
// Every export here is total: garbage in yields a usable domain or null, never
// a throw and never NaN. The hooks run these on every animation frame of a
// live gesture, where a thrown error would leave the chart wedged mid-drag.

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

/** Are these the same domain? Reference equality first, then element-wise, so
 *  it holds for the sentinel pair as well as for numbers. Both hooks dedupe
 *  their per-frame emissions with it: a gesture frame that solves to the domain
 *  already on screen must not write state, because that re-renders every panel.
 *  @param {unknown} a
 *  @param {unknown} b
 *  @returns {boolean} */
export function sameDomain(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return a[0] === b[0] && a[1] === b[1]
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

/** How far in the deepest zoom can go, as a multiple of the full span. */
export const MAX_ZOOM = 50

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
 *   where in the window to hold still if the span has to change out from under
 *   the user.
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
    // Re-anchor about that fraction instead of pinning `start`. Pinning it
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

// ── The window and the view ────────────────────────────────────────────────
//
// Zooming used to plot exactly the window, so everything outside it was clipped
// away and nothing on the chart said where the window's edges were. The plotted
// range is now the window PLUS a context margin on each side; the margin draws
// faded (ui/ZoomWindowOverlay.jsx), so a zoom is legible on the chart itself.
//
//   zoomDomain — THE WINDOW. Unchanged meaning, unchanged name, so everything
//                downstream of it (stats/statsBasis.js, the header's duration,
//                MapPanel's bright segment, the reset control) is untouched.
//   viewDomain — WHAT IS PLOTTED: the window padded by CONTEXT_MARGIN each
//                side and clamped into fullExtent. Every <XAxis domain> reads
//                this one.
//
// Unzoomed stays byte-identical: the sentinel window yields the sentinel view,
// shoulders of zero width, and an identity fraction remap in the gesture.

/** Shoulder width on each side, as a fraction of the window's span. */
export const CONTEXT_MARGIN = 0.25

/** True only for a usable numeric extent. Everything below is total, and every
 *  one of them starts by asking this. */
function usableExtent(fullExtent) {
  if (!Array.isArray(fullExtent) || fullExtent.length !== 2) return false
  const span = fullExtent[1] - fullExtent[0]
  return Number.isFinite(span) && span > 0
}

/** [0,1] clamp. Inlined rather than imported from ui/chartGeometry.js on
 *  purpose: this module has no imports at all, and pixels have no business
 *  here. */
function clamp01(fraction) {
  if (!Number.isFinite(fraction)) return 0
  return Math.min(1, Math.max(0, fraction))
}

/**
 * The range to plot for a given window: the window padded by `margin` of its own
 * span each side, clamped into the extent.
 *
 * A SHOULDER EXISTS ONLY WHERE DATA EXISTS. With the window pinned against the
 * start of the activity the clamp bites and the left shoulder is zero width —
 * the honest picture, and what keeps "window == full extent" from ever drawing
 * as though there were more activity beyond the edge.
 *
 * Note what this does to the effective on-screen magnification: the view is
 * (1 + 2·margin) = 1.5× the window, so the deepest visible magnification is
 * MAX_ZOOM / 1.5 ≈ 33×. MAX_ZOOM stays 50 — it caps the WINDOW, which is the
 * quantity minSpanFor documents itself as bounding and the quantity the stats
 * and the header duration report on.
 *
 * @param {unknown} zoomDomain - the window, sentinel or numeric
 * @param {[number, number] | null} fullExtent
 * @param {number} [margin]
 * @returns {[number, number] | ['dataMin', 'dataMax']}
 */
export function viewDomainFor(zoomDomain, fullExtent, margin = CONTEXT_MARGIN) {
  if (isFullDomain(zoomDomain) || !usableExtent(fullExtent)) return fullDomain()
  const [fullMin, fullMax] = fullExtent
  const pad = Number.isFinite(margin) && margin > 0 ? margin : 0
  const [start, end] = resolveDomain(zoomDomain, fullExtent)
  const shoulder = (end - start) * pad
  const view = [Math.max(fullMin, start - shoulder), Math.min(fullMax, end + shoulder)]
  return snapToFull(view, fullExtent)
}

/**
 * Where the window's two edges sit across the plotted view, as fractions.
 *
 * TWO CONSUMERS, DELIBERATELY ONE FUNCTION: the overlay positions its shoulders
 * and handles from these, and useWheelPan re-expresses a swipe's plot travel
 * against the window with them. Two derivations would be free to disagree, and
 * the symptom would be a handle that does not sit where the drag thinks it
 * does.
 *
 * Only the WINDOW's sentinel short-circuits to [0, 1]. A sentinel VIEW is
 * resolved like any other domain, because it is a real and reachable state: a
 * window wider than 1/(1 + 2·margin) of the activity pads out past both ends and
 * snapToFull turns the view back into the sentinel, while the window inside it
 * is still a genuine zoom with shoulders to draw.
 *
 * @param {unknown} zoomDomain - the window
 * @param {unknown} viewDomain - what is plotted
 * @param {[number, number] | null} fullExtent
 * @returns {[number, number]} [0, 1] whenever there is no zoom to describe
 */
export function windowFractions(zoomDomain, viewDomain, fullExtent) {
  if (isFullDomain(zoomDomain) || !usableExtent(fullExtent)) return [0, 1]
  const view = resolveDomain(viewDomain, fullExtent)
  if (view[1] - view[0] <= 0) return [0, 1]
  const win = resolveDomain(zoomDomain, fullExtent)
  return [clamp01(fractionOfValue(win[0], view)), clamp01(fractionOfValue(win[1], view))]
}

/**
 * Re-express travel across the PLOT as travel across the WINDOW — what the
 * trackpad pan needs.
 *
 * A DISTANCE, not a position, which is why it divides by the window's share of
 * the plot and does not subtract an origin: a translation has no origin.
 * Without this, a swipe would move the content by the window's share of the
 * plot (⅔ of the finger's travel at the default margin) instead of 1:1, which
 * is the property panByFraction's own comment says it exists to hold. Unzoomed
 * the fractions are [0, 1] and this is the identity.
 *
 * @param {number} plotDelta - travel as a fraction of the PLOT's width
 * @param {[number, number]} fractions - from windowFractions
 * @returns {number} travel as a fraction of the WINDOW's width
 */
export function toWindowDelta(plotDelta, fractions) {
  if (!Array.isArray(fractions) || !Number.isFinite(plotDelta)) return plotDelta
  const span = fractions[1] - fractions[0]
  if (!Number.isFinite(span) || span <= 0) return plotDelta
  return plotDelta / span
}

/**
 * Put one edge of the window at `value` — what dragging a handle solves.
 *
 * The edge is clamped into the VIEW rather than into the extent, because the
 * view is what is on screen and the handle cannot be dragged past it. The other
 * edge does not move. snapToFull at the end is what makes dragging an edge all
 * the way back out restore the sentinel, so the Reset control disappears by the
 * rule it already follows rather than by a rule of this function's own.
 *
 * @param {unknown} zoomDomain - the current window
 * @param {'start' | 'end'} edge
 * @param {number} value
 * @param {unknown} viewDomain - the plotted range the drag happens inside
 * @param {[number, number] | null} fullExtent
 * @param {{minSpan?: number}} [opts]
 * @returns {[number, number] | ['dataMin', 'dataMax']}
 */
export function moveWindowEdge(zoomDomain, edge, value, viewDomain, fullExtent, { minSpan = 0 } = {}) {
  if (!usableExtent(fullExtent)) return fullDomain()
  const view = resolveDomain(viewDomain, fullExtent)
  const current = resolveDomain(zoomDomain, fullExtent)
  const viewSpan = view[1] - view[0]
  if (!Number.isFinite(value) || viewSpan <= 0) return snapToFull(current, fullExtent)

  // Never wider than the view can hold, so an activity shorter than the floor
  // stays draggable rather than pinning both edges — same ordering rule as
  // clampDomain, where fullSpan wins over minSpan.
  const floor = Number.isFinite(minSpan) && minSpan > 0 ? Math.min(minSpan, viewSpan) : 0
  const target = Math.min(view[1], Math.max(view[0], value))

  let [start, end] = current
  if (edge === 'start') {
    start = Math.min(target, end - floor)
    if (start < view[0]) {
      start = view[0]
      end = Math.min(view[1], Math.max(end, start + floor))
    }
  } else {
    end = Math.max(target, start + floor)
    if (end > view[1]) {
      end = view[1]
      start = Math.max(view[0], Math.min(start, end - floor))
    }
  }
  return snapToFull([start, end], fullExtent)
}

/**
 * Translate the window sideways without changing its width. What the trackpad
 * pan path calls.
 *
 * `fractionDelta` is how far the gesture travelled as a fraction of the PLOT
 * WIDTH, signed like a scrollbar: positive moves the window forward, i.e. the
 * content slides left under the fingers, matching every other horizontally
 * scrollable surface. Scaling it by the CURRENT span (not the full span) is
 * what keeps finger travel and content travel 1:1 at every zoom level.
 *
 * Three properties, all inherited rather than implemented here:
 *  - Width survives a pan into either end, because clampDomain translates
 *    rather than truncates — the window slides fully into view at the size the
 *    user asked for instead of shrinking against the edge.
 *  - `minSpan` is deliberately left at its default 0: the incoming span came
 *    from an already-clamped domain, and panning is not the place to
 *    retroactively fix a zoom-limit violation.
 *  - Panning at full zoom is a self-cancelling no-op — the clamp slides it back
 *    to the extent, snapToFull returns the sentinel, and the hook's emit dedupe
 *    swallows it. No special case needed.
 *
 * @param {unknown} domain - current zoomDomain, sentinel or numeric
 * @param {[number, number]} fullExtent
 * @param {number} fractionDelta
 * @returns {[number, number] | ['dataMin', 'dataMax'] | null}
 */
export function panByFraction(domain, fullExtent, fractionDelta) {
  if (!Number.isFinite(fractionDelta)) return null
  const current = resolveDomain(domain, fullExtent)
  const span = current[1] - current[0]
  const shift = fractionDelta * span
  if (!Number.isFinite(shift) || shift === 0) return null
  const clamped = clampDomain([current[0] + shift, current[1] + shift], fullExtent)
  return snapToFull(clamped, fullExtent)
}
