// Where the plot area actually is on screen, in client pixels — the bridge
// between a finger's clientX and a fraction across the x-domain.
//
// The constants below are the ones MetricPanel hands to Recharts, and it
// imports them from here rather than declaring its own. That is the whole
// point of this module existing: the gesture subtracts exactly the numbers the
// chart was laid out with, so the two agree by construction instead of by two
// people remembering to keep a pair of literals in sync.

/** FIXED across every panel, so their plot areas align pixel-for-pixel
 *  (ARCHITECTURE.md §7). Fed to <YAxis width>. */
export const Y_AXIS_WIDTH = 56

/** Fed to <LineChart margin>. */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 16, left: 4 }

// Below this the plot is too small to gesture in at all, and the arithmetic
// would start producing negative widths.
const MIN_PLOT_WIDTH = 32

/**
 * The plot rect implied by a `.recharts-surface` rect.
 *
 * Split out from plotRectOf so it can be unit-tested: setupTests.js hard-
 * assigns getBoundingClientRect to one fixed rect for EVERY element, so an
 * integration test literally cannot tell "we measured the surface" from "we
 * measured the stack" — the numbers come back identical either way. The
 * arithmetic has to be pinned here or it isn't pinned anywhere.
 *
 * @param {{left: number, width: number}} surfaceRect
 * @returns {{left: number, width: number} | null} null when there's no usable plot
 */
export function plotRectFromSurface(surfaceRect) {
  if (!surfaceRect) return null
  const inset = Y_AXIS_WIDTH + CHART_MARGIN.left
  const left = surfaceRect.left + inset
  const width = surfaceRect.width - inset - CHART_MARGIN.right
  if (!Number.isFinite(left) || !Number.isFinite(width) || width < MIN_PLOT_WIDTH) return null
  return { left, width }
}

/**
 * Measure the plot area under `el`.
 *
 * Measures the first `.recharts-surface` (the <svg> Recharts emits, which
 * ResponsiveContainer gives an explicit pixel width) rather than the stack
 * element itself. The stack carries 8px of padding AND a 1px border, both
 * included in its own rect, so a stack-relative formula would need
 * `+1 +8 +56 +4` and would silently desync by a few pixels the first time
 * anyone touches that CSS — invisible in review, maddening in the hand.
 *
 * Call once per gesture start (cache it in the gesture) and once per wheel
 * event. Never per move frame: it forces layout.
 *
 * @param {Element | null} el
 * @returns {{left: number, width: number} | null}
 */
export function plotRectOf(el) {
  const surface = el?.querySelector('.recharts-surface')
  if (!surface) return null
  return plotRectFromSurface(surface.getBoundingClientRect())
}

/** Where a client x sits across the plot, 0 at the left edge and 1 at the
 *  right. Unclamped on purpose — see valueAtFraction in domain/zoomDomain.js.
 *  @param {number} clientX
 *  @param {{left: number, width: number}} plotRect
 *  @returns {number} */
export function fractionAcross(clientX, plotRect) {
  if (!plotRect || plotRect.width <= 0) return 0
  return (clientX - plotRect.left) / plotRect.width
}

/** For the one caller that does want [0,1]: the wheel anchor, where the
 *  cursor can sit over the axis gutter and zooming about a point outside the
 *  plot reads as the chart lurching.
 *  @param {number} fraction
 *  @returns {number} */
export function clampFraction(fraction) {
  if (!Number.isFinite(fraction)) return 0.5
  return Math.min(1, Math.max(0, fraction))
}
