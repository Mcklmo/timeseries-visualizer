// Dragging one edge of the zoom window — the direct-manipulation half of the
// feature ZoomWindowOverlay draws.
//
// The gesture drives the crosshair as well as the window: every panel's head
// reports its metric's value AT THE BOUNDARY while an edge moves, so cutting
// the first five minutes off a race is done by looking at the numbers rather
// than by arithmetic. The readout stays put on release — the same deliberate
// choice useTouchScrub makes, for the same reason (the numbers exist to be
// read after the hand has moved away).
//
// THIS IS THE ONLY WAY TO ZOOM. Pinch and ctrl/⌘+wheel used to exist alongside
// it and were deleted (ui/useWheelPan.js records why), so everything zooming
// needs has to be reachable from one handle and one pointer — which is what the
// edge expansion below exists for.
//
// NO GESTURE ARBITRATION IS NEEDED, and none is written here. A handle is a
// real DOM element above .recharts-wrapper, so the DOM arbitrates for free:
// useTouchScrub and useTouchHoverHandoff both bail when the touch target is
// outside every wrapper, and nothing else on the stack claims a pointer.
// The one consequence is the release below.
//
// THE VIEW IS FROZEN WHILE THE POINTER IS INSIDE THE PLOT. This is the
// non-obvious part and it will be "simplified" out if the reason is not here:
// if the plotted view tracked the window live, it would run away. With
// view = window ± 25%, the start handle sits at plot fraction 1/6 ALWAYS. Pull
// the pointer right of 1/6 → the window shrinks → the view shrinks with it →
// the handle redraws at 1/6, once again left of the pointer → it shrinks again,
// every frame, never converging. So the view and the plot rect are captured at
// pointerdown and held; the graph does not move under your hand, and it re-fits
// exactly once, on release. That is also why viewDomain is real state and not a
// derived value.
//
// THE ONE EXCEPTION: held at the plot edge, the window keeps expanding. Without
// it, dragging a handle to the edge dead-stops and widening further means
// releasing, waiting for the re-fit to grow a new shoulder, and re-grabbing —
// which is unusable as the only way back out of a deep zoom. So while the
// pointer sits at or past the plot edge on the dragged edge's own outer side,
// the edge value walks outward at a fixed rate and the drag view grows WITH it,
// live. That is not the runaway above: the pointer is pinned at the edge and
// the rate is a constant, not a function of where the handle redrew.
//
// The expanding view keeps the FAR SIDE STILL — for a start drag it becomes
// [newEdgeValue, frozenView[1]]. One line, three properties:
//   - the window's start IS the view's start, so the handle stays at plot
//     fraction 0, exactly under the finger; nothing teleports when the pointer
//     comes back inside and the direct mapping resumes;
//   - the crosshair, already clamped to the plot edge, therefore reads exactly
//     the boundary value, so the readout stays truthful while expanding;
//   - the half of the chart being kept does not move — earlier data flows in
//     from the outside.
import { useCallback, useEffect, useRef } from 'react'
import {
  minSpanFor,
  moveWindowEdge,
  resolveDomain,
  sameDomain,
  snapToFull,
  valueAtFraction,
} from '../domain/zoomDomain.js'
import { clampFraction, fractionAcross, plotRectOf } from './chartGeometry.js'
import { moveCrosshairTo, releaseOtherHovers } from './crosshairDispatch.js'

// Expansion rate, as a continuous growth constant on the window's OWN span:
// span *= e^(k·dt). Exponential rather than linear so it feels the same at
// every zoom level — at k = 1 the deepest window (MAX_ZOOM = 50) reaches the
// whole activity in ln(50) ≈ 3.9s, and a shallow one gets there sooner.
const EXPAND_RATE_PER_S = 1.0

// dt comes from the rAF timestamp, NOT from a frame count: 120Hz ProMotion
// would otherwise expand at double the rate of a 60Hz display. And it is capped
// so a backgrounded tab, whose next frame can be seconds later, resumes by
// growing a little rather than by jumping straight to fully unzoomed.
const MAX_FRAME_S = 0.1

/**
 * @param {object} args
 * @param {unknown} args.zoomDomain - the window, sentinel or numeric
 * @param {unknown} args.viewDomain - what is currently plotted
 * @param {[number, number] | null} args.fullExtent
 * @param {number} [args.rightInset] - the derivative gutter, when the stack has
 *   one; the plot is that much narrower than the surface (ui/chartGeometry.js)
 * @param {(next: unknown, view: unknown) => void} args.onWindowChange - per
 *   frame. `view` is the drag's own view: the frozen one while the pointer is
 *   inside the plot, and the growing one while it is held at the edge. The
 *   caller writes both together — it must not re-fit a view of its own until
 *   the commit.
 * @param {(next: unknown) => void} args.onWindowCommit - on release, where the
 *   view is re-fitted symmetrically around the final window.
 * @returns {{ref: (node: Element | null) => void, onEdgePointerDown: (edge: 'start'|'end', event: {clientX: number}) => void}}
 */
export function useEdgeDrag({
  zoomDomain,
  viewDomain,
  fullExtent,
  rightInset = 0,
  onWindowChange,
  onWindowCommit,
}) {
  // Same latest-ref discipline as the other three hooks on this node, and for
  // the same reason: the ref callback below keeps a `[]` dep array, and
  // `zoomDomain` changes on every frame of a live drag. A callback closing over
  // it would change identity each frame and React would tear the listeners down
  // and re-attach them mid-gesture.
  const latest = useRef({ zoomDomain, viewDomain, fullExtent, rightInset, onWindowChange, onWindowCommit })
  useEffect(() => {
    latest.current = { zoomDomain, viewDomain, fullExtent, rightInset, onWindowChange, onWindowCommit }
  })

  const gesture = useRef({
    /** @type {Element | null} the .chart-stack, from the ref below */
    node: null,
    /** @type {'start' | 'end' | null} */
    edge: null,
    /** @type {number | null} the pointer that started the drag, so a second
     *  finger anywhere on the page cannot drive it. Null when the caller handed
     *  us an event without one, in which case there is nothing to filter on. */
    pointerId: null,
    /** @type {[number, number] | null} the drag's view: frozen at pointerdown,
     *  and grown on the dragged side only while expanding. Always a fresh
     *  array, never mutated — the caller holds it as React state. */
    view: null,
    /** @type {{left: number, width: number} | null} frozen for the gesture */
    plotRect: null,
    /** Whether the last frame was expanding at the plot edge. Also the flag the
     *  rAF loop re-schedules itself on, since a stationary finger sends no
     *  pointermove to schedule the next frame. */
    expanding: false,
    /** rAF timestamp of the last expanding frame, for dt. */
    lastTime: 0,
    /** @type {Element | null} the panel whose crosshair the drag drives */
    wrapper: null,
    /** @type {unknown} the last window emitted, so pointerup commits what the
     *  user actually sees rather than re-solving it */
    window: null,
    /** @type {unknown} the last view emitted, for the same-frame dedupe only */
    emittedView: null,
    clientX: 0,
    frame: 0,
    /** @type {((edge: 'start'|'end', event: {clientX: number}) => void) | null}
     *  Set by the ref callback below and read by the stable onEdgePointerDown
     *  the panels are handed — the gesture's live entry point, kept off the
     *  callback's identity so the overlays never re-render for it. */
    start: null,
  })

  const ref = useCallback((node) => {
    gesture.current.node = node
    if (!node) return undefined
    const g = gesture.current

    function end() {
      if (g.frame !== 0) cancelAnimationFrame(g.frame)
      g.frame = 0
      g.edge = null
      g.pointerId = null
      g.view = null
      g.plotRect = null
      g.wrapper = null
      g.window = null
      g.emittedView = null
      g.expanding = false
      g.lastTime = 0
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }

    /** The edge value for a frame spent held at the plot edge, and the view that
     *  goes with it. Grows the window's own span by e^(k·dt), outward, clamped
     *  into the extent; the view's dragged side follows the edge exactly, which
     *  is what pins the handle to plot fraction 0 (or 1).
     *
     *  It takes the OUTWARD-MOST of the walk and `direct` — where the clamped
     *  pointer would have put the edge. In the steady state those are the same
     *  number, since the expanding view's edge IS the window's edge; they differ
     *  only on the frame the pointer arrives at the plot edge, where the direct
     *  value is further out and taking it is what keeps the handoff from the
     *  direct phase continuous instead of dropping the edge back inward. */
    function expandFrom(current, extent, time, direct) {
      const now = Number.isFinite(time) ? time : performance.now()
      // The first expanding frame grows by nothing: there is no previous
      // timestamp to measure against, and inventing one would make the rate
      // depend on how the frame happened to be scheduled.
      const dt = g.expanding ? Math.min(MAX_FRAME_S, Math.max(0, (now - g.lastTime) / 1000)) : 0
      g.expanding = true
      g.lastTime = now

      const [start, end] = resolveDomain(current, extent)
      const grow = (end - start) * (Math.exp(EXPAND_RATE_PER_S * dt) - 1)
      if (g.edge === 'start') {
        const value = Math.max(extent[0], Math.min(direct, start - grow))
        g.view = [value, g.view[1]]
        return value
      }
      const value = Math.min(extent[1], Math.max(direct, end + grow))
      g.view = [g.view[0], value]
      return value
    }

    function frameHandler(time) {
      g.frame = 0
      if (!g.edge || !g.view || !g.plotRect) return
      const { zoomDomain: current, fullExtent: extent, onWindowChange: notify } = latest.current
      if (!extent) return

      // The RAW fraction, before the clamp: at/past the plot edge on the dragged
      // edge's own outer side is what "held at the edge" means, and a clamped
      // fraction cannot tell that apart from merely being at the edge.
      const raw = fractionAcross(g.clientX, g.plotRect)
      const atOuterEdge = g.edge === 'start' ? raw <= 0 : raw >= 1

      // Solved against the FROZEN view and the FROZEN rect — see the header —
      // except while expanding, where `value` and the drag view's own matching
      // end are the same number, so moveWindowEdge's clamp into the view is a
      // no-op there and it stays the one solver either way.
      const direct = valueAtFraction(clampFraction(raw), g.view)
      let value
      if (atOuterEdge) {
        value = expandFrom(current, extent, time, direct)
      } else {
        g.expanding = false
        value = direct
      }
      const next = moveWindowEdge(current, g.edge, value, g.view, extent, {
        minSpan: minSpanFor(extent[1] - extent[0]),
      })
      // snapToFull on the view as well as the window: expanding all the way out
      // must restore the sentinel view, or the unzoomed render would come back
      // as a numeric domain with allowDataOverflow flipped on. It returns the
      // array unchanged in every other case.
      const view = snapToFull(g.view, extent)
      // Dedupe, because setZoom writes a fresh state object and re-renders every
      // panel. It earns its keep in one specific place: an edge already parked
      // against the extent still reads as "held at the plot edge", so the
      // expansion loop keeps running and clamping to the same number — without
      // this that is 60 full re-renders a second for a gesture doing nothing.
      const changed = !sameDomain(next, g.window) || !sameDomain(view, g.emittedView)
      g.window = next
      g.emittedView = view
      if (changed) notify?.(next, view)

      // The readout: every panel is synced, so driving the one under the handle
      // makes all of their heads report at the boundary being dragged.
      if (g.wrapper) moveCrosshairTo(g.wrapper, g.plotRect, g.clientX)

      // Keep the loop alive while expanding. Frames are otherwise scheduled only
      // from pointermove, and the whole point of this phase is that the finger
      // is stationary.
      if (g.expanding) scheduleFrame()
    }

    // Coalesced to one solve per frame: each emission re-renders N LineCharts
    // with interval={0} axes, and a high-refresh pointer fires far faster than
    // that.
    function scheduleFrame() {
      if (g.frame !== 0) return
      g.frame = requestAnimationFrame(frameHandler)
    }

    /** Every window listener below filters on this. Without it a second finger
     *  anywhere on the page drives the drag — which matters now that a
     *  two-finger pinch over the charts is a live browser gesture rather than
     *  one this app swallows. */
    function isDragPointer(e) {
      return g.edge !== null && (g.pointerId === null || e.pointerId === g.pointerId)
    }

    function handlePointerMove(e) {
      if (!isDragPointer(e)) return
      g.clientX = e.clientX
      scheduleFrame()
    }

    function handlePointerUp(e) {
      if (!isDragPointer(e)) return
      // Flush a pending frame rather than dropping it: a quick drag can put
      // pointerdown, pointermove and pointerup inside a single animation frame,
      // and cancelling there would make the whole gesture a no-op.
      if (g.frame !== 0) {
        cancelAnimationFrame(g.frame)
        frameHandler()
      }
      const committed = g.window
      const { onWindowCommit: commit } = latest.current
      end()
      // Nothing clears the crosshair here, deliberately: it must stay on screen
      // after the pointer lifts so the boundary's numbers can be read — the same
      // choice, and the same reason, as useTouchScrub.handleTouchEnd.
      if (committed !== null) commit?.(committed)
    }

    // A cancelled pointer (the OS taking over, a context menu) is NOT flushed —
    // whatever the last frame emitted stands — but it must still commit, so the
    // view re-fits around it. A frozen view left behind here would be a chart
    // that quietly stops re-fitting for the rest of the session.
    function handlePointerCancel(e) {
      if (!isDragPointer(e)) return
      const committed = g.window
      const { onWindowCommit: commit } = latest.current
      end()
      if (committed !== null) commit?.(committed)
    }

    function start(edge, event) {
      const { viewDomain: view, fullExtent: extent, rightInset: inset } = latest.current
      if (!extent) return
      const plotRect = plotRectOf(node, inset)
      if (!plotRect) return

      g.edge = edge
      // Captured so the window listeners can ignore every other pointer. A
      // caller that hands us a bare {clientX} leaves this null and nothing is
      // filtered, which is the only honest answer when there is no id.
      g.pointerId = Number.isFinite(event?.pointerId) ? event.pointerId : null
      // Resolved to numbers ONCE, here: the sentinel view means the whole
      // extent, and re-resolving per frame against a window that is changing
      // underneath us is precisely the runaway the freeze exists to stop.
      // Expansion moves this deliberately, and only ever on the dragged side.
      g.view = resolveDomain(view, extent)
      g.plotRect = plotRect
      g.window = null
      g.emittedView = null
      g.expanding = false
      g.lastTime = 0
      g.clientX = event.clientX
      // The first .recharts-wrapper, matching plotRectOf's own "measure the
      // first surface" rule — §7 guarantees every panel's plot area aligns
      // pixel-for-pixel, and syncId carries the hover to the rest.
      g.wrapper = node.querySelector('.recharts-wrapper')
      // useTouchHoverHandoff cannot do this for us: its guard requires the touch
      // target to be inside a wrapper, and a handle is by construction outside
      // every one of them. Without it, a panel left holding a stale self-hover
      // outranks the sync events this drag is about to send and freezes at its
      // old index.
      if (g.wrapper) releaseOtherHovers(node, g.wrapper)

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
      // Emit the first frame immediately: a pointerdown that lands slightly off
      // the handle's own line should snap the edge there rather than wait for a
      // move that may never come.
      scheduleFrame()
    }

    g.start = start

    // On window, not the node, and NOT setPointerCapture: capture is undefined
    // in jsdom 30 so it would throw in every chart test, and it retargets events
    // in ways that can confuse Recharts' own hover bookkeeping. A pointer that
    // slides off the chart mid-drag must keep driving it, and one released
    // off-element must still release it — window listeners give both.
    return () => {
      end()
      g.node = null
      g.start = null
    }
    // A CALLBACK ref, not an object ref + useEffect, for the same reason as the
    // other three hooks on this node: ChartStack early-returns null before an
    // activity loads, so an effect keyed on [] would run once against a div that
    // does not exist and never re-run when the activity arrives. The dep array
    // must stay [] — everything mutable is read through `latest`.
  }, [])

  // Handed to every panel's overlay, so it is stable for the same reason `ref`
  // is; the gesture ref holds the live `start`.
  const onEdgePointerDown = useCallback((edge, event) => {
    gesture.current.start?.(edge, event)
  }, [])

  return { ref, onEdgePointerDown }
}
