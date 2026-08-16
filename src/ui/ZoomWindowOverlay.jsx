// The faded shoulders and the two draggable edges of the zoom window.
//
// WHY THIS EXISTS: zooming used to be invisible. The x-domain narrowed, so
// everything outside the window was clipped away, and the only cues that you
// were zoomed at all were the header's duration and a Reset button appearing.
// The plot now draws the window PLUS a context margin each side
// (domain/zoomDomain.js's viewDomainFor); this overlay is what makes that
// legible — the margin washed out, the window clear — and it puts a handle on
// each boundary so trimming the start or end of an activity is direct
// manipulation rather than a pinch fought against its own anchor.
//
// PURELY PRESENTATIONAL, AND POSITIONED ENTIRELY IN PERCENTAGES of the plot
// area: no getBoundingClientRect, no ResizeObserver, nothing that has to be
// re-measured when the panel resizes. It sits in a `position: relative` wrapper
// alongside the <ResponsiveContainer> and is inset by --plot-inset /
// --plot-right-inset, exactly the pattern .map-panel__canvases already uses, so
// its 0% and 100% are the chart's own plot edges.
import { formatDistanceKm, formatDuration } from '../domain/units.js'
import { CHART_MARGIN, X_AXIS_HEIGHT } from './chartGeometry.js'

// Keyboard steps, as fractions of the FULL extent — unit-agnostic, so one
// arrow press means the same proportion of the activity in both x-modes, the
// same reasoning as minSpanFor's. The window is otherwise unreachable without a
// pointer, which for a control this central is not acceptable.
const KEY_STEP = 0.01
const KEY_PAGE_STEP = 0.1

/** @param {'start'|'end'} edge */
const edgeLabel = (edge) => (edge === 'start' ? 'Window start' : 'Window end')

/**
 * @param {object} props
 * @param {[number, number]} props.fractions - where the window's edges sit
 *   across the plot, from domain/zoomDomain.js's windowFractions. ONE source
 *   for these and for the gesture's remap, so a handle cannot sit somewhere the
 *   drag does not think it is.
 * @param {boolean} props.showXAxis - whether this panel draws the shared x-axis,
 *   which is the only thing that changes the overlay's bottom inset
 * @param {[number, number]} props.windowValues - the window's two edges as
 *   numbers, for the sliders' aria values
 * @param {[number, number] | null} props.fullExtent
 * @param {'time'|'distance'} props.xMode - which formatter reads the values out
 * @param {(edge: 'start'|'end', event: React.PointerEvent) => void} [props.onEdgePointerDown]
 * @param {(edge: 'start'|'end', value: number) => void} [props.onEdgeKeyMove] - a
 *   keyboard move, already resolved to a domain value. Committed immediately:
 *   discrete presses have nothing to freeze the view against (see §2.2 of the
 *   handover — the runaway is a pointer-tracking problem).
 */
export function ZoomWindowOverlay({
  fractions,
  showXAxis,
  windowValues,
  fullExtent,
  xMode,
  onEdgePointerDown,
  onEdgeKeyMove,
}) {
  const [f0, f1] = fractions
  const format = xMode === 'distance' ? formatDistanceKm : formatDuration

  // The plot floor. A hidden <XAxis> contributes 0 to Recharts' bottom offset
  // (selectBottomAxesOffset skips `hide`), so only the axis-bearing panel has
  // the band to clear — and clear it we must, or the shoulders dim the tick
  // labels that are shared by the whole stack.
  const bottom = CHART_MARGIN.bottom + (showXAxis ? X_AXIS_HEIGHT : 0)

  function handleKeyDown(edge, e) {
    if (!onEdgeKeyMove || !fullExtent) return
    const span = fullExtent[1] - fullExtent[0]
    if (!Number.isFinite(span) || span <= 0) return
    const value = edge === 'start' ? windowValues[0] : windowValues[1]
    let next = null
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - span * KEY_STEP
        break
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + span * KEY_STEP
        break
      case 'PageDown':
        next = value - span * KEY_PAGE_STEP
        break
      case 'PageUp':
        next = value + span * KEY_PAGE_STEP
        break
      // Home/End park the edge against the activity, which for the two of them
      // together is how the keyboard gets back to unzoomed.
      case 'Home':
        next = fullExtent[0]
        break
      case 'End':
        next = fullExtent[1]
        break
      default:
        return
    }
    // Only for keys we handled: an unhandled key must keep doing whatever it
    // does, including Tab moving on to the other handle.
    e.preventDefault()
    onEdgeKeyMove(edge, next)
  }

  function handle(edge, fraction) {
    const value = edge === 'start' ? windowValues[0] : windowValues[1]
    return (
      <div
        className="zoom-handle"
        style={{ left: `${fraction * 100}%` }}
        role="slider"
        tabIndex={0}
        aria-label={edgeLabel(edge)}
        aria-valuemin={fullExtent ? fullExtent[0] : undefined}
        aria-valuemax={fullExtent ? fullExtent[1] : undefined}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        aria-valuetext={Number.isFinite(value) ? format(value) : undefined}
        onPointerDown={(e) => onEdgePointerDown?.(edge, e)}
        onKeyDown={(e) => handleKeyDown(edge, e)}
      />
    )
  }

  // NOT conditional on !isFullDomain. Unzoomed this renders zero-width shoulders
  // with both handles parked on the plot edges, and that is deliberate: parked
  // handles are the affordance for STARTING a trim. Nothing is dimmed and
  // nothing is drawn over the lines, so an unzoomed chart still looks exactly
  // as it did.
  return (
    <div className="zoom-window" style={{ top: CHART_MARGIN.top, bottom }}>
      <div className="zoom-window__shoulder" style={{ left: 0, width: `${f0 * 100}%` }} />
      <div className="zoom-window__shoulder" style={{ left: `${f1 * 100}%`, right: 0 }} />
      {handle('start', f0)}
      {handle('end', f1)}
    </div>
  )
}
