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

/** Width of the right-hand derivative axis, fed to <YAxis width> when any panel
 *  in the stack has an overlay switched on. Narrower than Y_AXIS_WIDTH because
 *  it carries short signed rates ("+12.4") rather than the left axis's clock
 *  labels.
 *
 *  STACK-WIDE, NEVER PER PANEL. The gutter is reserved on every visible panel
 *  the moment ANY of them enables a derivative, and on none when none do —
 *  ChartStack computes it once. Two reasons, and both are silent failures:
 *  plotRectOf measures only the FIRST .recharts-surface in the stack and
 *  applies that rect to gestures anywhere on it, so a per-panel gutter would
 *  drift a pinch ~44px out from under the fingers; and §7 requires every
 *  panel's plot area to align pixel-for-pixel, because syncId pairs panels by
 *  data index and the shared crosshair must land on the same screen x. */
export const Y_AXIS_RIGHT_WIDTH = 44

/** Fed to <LineChart margin>. */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 16, left: 4 }

/** Height of the x-axis band, fed to <XAxis height> on the panel that shows one.
 *  This is Recharts' own default made explicit, so it changes nothing about the
 *  layout — it exists to be READ. ui/ZoomWindowOverlay.jsx insets itself by this
 *  number so the faded shoulders stop at the plot floor instead of dimming the
 *  tick labels below it, and the same rule as the rest of this module applies:
 *  the number the chart lays out with and the number the overlay measures with
 *  are one number. */
export const X_AXIS_HEIGHT = 30

/**
 * Where the plot area starts, measured in from a panel's left edge: exactly the
 * sum `plotRectFromSurface` subtracts on that side.
 *
 * Handed to CSS as `--plot-inset` by both MetricPanel (so a head's label sits
 * over the line it names rather than over the y-axis gutter) and MapPanel (so
 * the map's drawing area lines up with the plot areas of the charts below it).
 * It lives HERE rather than in either of them for the reason this whole module
 * exists: two panels deriving it separately would be two things free to drift
 * from the one number the gesture subtracts.
 */
export const PLOT_INSET = Y_AXIS_WIDTH + CHART_MARGIN.left

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
 * @param {number} [rightInset] - Y_AXIS_RIGHT_WIDTH while any panel shows a
 *   derivative overlay, 0 otherwise. Defaults to 0 so a stack with no overlay
 *   measures byte-identically to how it did before this axis existed — the same
 *   "conditional, not unconditional" rule MetricPanel's allowDataOverflow
 *   follows, and the same reason MetricPanel defaults the prop.
 * @returns {{left: number, width: number} | null} null when there's no usable plot
 */
export function plotRectFromSurface(surfaceRect, rightInset = 0) {
  if (!surfaceRect) return null
  const inset = Y_AXIS_WIDTH + CHART_MARGIN.left
  const left = surfaceRect.left + inset
  const width = surfaceRect.width - inset - CHART_MARGIN.right - rightInset
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
 * @param {number} [rightInset] - see plotRectFromSurface
 * @returns {{left: number, width: number} | null}
 */
export function plotRectOf(el, rightInset = 0) {
  const surface = el?.querySelector('.recharts-surface')
  if (!surface) return null
  return plotRectFromSurface(surface.getBoundingClientRect(), rightInset)
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

// Recharts draws the crosshair as a <Curve className="recharts-tooltip-cursor">
// inside each panel's .recharts-surface, and only while the tooltip is active
// (component/Cursor.js returns null without an active coordinate). A vertical
// line's path is therefore `M<x>,<top>L<x>,<bottom>` — the leading moveto is
// where the crosshair is.
const CURSOR_START_X = /^\s*M\s*(-?[\d.]+)[,\s]/

/**
 * The x of a rendered tooltip cursor, in SVG user units.
 *
 * Pure, and split from crosshairClientX for the reason at the top of
 * chartGeometry.test.js: the impure half cannot be pinned in a rendered test,
 * this half can.
 *
 * @param {string | null | undefined} d - the cursor path's `d` attribute
 * @returns {number | null} null when there is no cursor, or none we recognise
 */
export function parseCursorX(d) {
  if (typeof d !== 'string') return null
  const match = CURSOR_START_X.exec(d)
  if (!match) return null
  const x = Number(match[1])
  return Number.isFinite(x) ? x : null
}

/**
 * Where the crosshair currently is under `el`, in client pixels.
 *
 * READ THE DOM RATHER THAN REMEMBERING THE LAST X DISPATCHED. A pinch moves the
 * crosshair's *pixel* position without changing its index, and a desktop mouse
 * can place it too, so any cached pixel value goes stale. Re-reading per
 * gesture is also what makes repeated swipes accumulate instead of all
 * measuring from the same original point.
 *
 * SVG user units are client pixels 1:1 here: ResponsiveContainer sizes the
 * <svg> in CSS pixels with no transform. That is the same assumption Recharts
 * itself encodes as `scaleX = rect.width / bbox.width` in
 * util/getRelativeCoordinate.js.
 *
 * @param {Element | null} el
 * @returns {number | null} null while no crosshair is rendered
 */
export function crosshairClientX(el) {
  const cursor = el?.querySelector('.recharts-tooltip-cursor')
  const surface = el?.querySelector('.recharts-surface')
  if (!cursor || !surface) return null
  const x = parseCursorX(cursor.getAttribute('d'))
  if (x === null) return null
  return surface.getBoundingClientRect().left + x
}
