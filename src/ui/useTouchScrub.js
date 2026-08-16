// Relative crosshair scrubbing on touch: a tap leaves the crosshair exactly
// where it is, and a horizontal swipe drags it by the distance the finger
// travelled, 1:1.
//
// THE PROBLEM THIS EXISTS FOR: a finger positions the crosshair *absolutely*.
// Touch a chart and it jumps to that x — so the point you wanted to look at is
// then under your fingertip. The numbers are fine (CrosshairReadout.jsx moved
// them out of the plot long ago); it is the graph SHAPE at the point being read
// that your own hand hides. Scrubbing relatively lets the finger rest far from
// the point it is reading. Mouse behaviour is deliberately untouched: a cursor
// obscures nothing, so hover-to-position is already right on desktop.
//
// TWO INDEPENDENT JUMP PATHS have to be closed or the feature half-works. Both
// were verified by reading recharts@3.10.1:
//   1. touchmove → React onTouchMove on .recharts-wrapper → touchEventAction →
//      setMouseOverAxisIndex AT THE FINGER (state/touchEventsMiddleware.js). A
//      held finger always jitters, so this is what fires during a tap-and-hold.
//      Closed by stopping touchmove in the CAPTURE phase, so it never reaches
//      React's root delegation. The same stop covers ≥2 touches, where the
//      gesture is the browser's page zoom and Recharts would otherwise drag the
//      crosshair to the fingers — usePinchZoom used to do that half as a side
//      effect of owning the pinch, and it is gone. (touchstart itself dispatches
//      no tooltip action, only externalEventAction, so it is not a source.)
//   2. The browser's COMPATIBILITY MOUSE EVENTS after a tap — mousemove,
//      mousedown, mouseup, click — → React onMouseMove → mouseMoveAction at the
//      tap point (state/mouseEventsMiddleware.js). This is the path a clean,
//      motionless tap takes. Closed by preventDefault on touchend, which is
//      what suppresses them. jsdom synthesizes no compatibility events at all,
//      so only a real device can catch a regression here — see the honesty note
//      at the foot of useTouchScrub.test.jsx.
//
// HOW THE CROSSHAIR IS MOVED AT ALL: there is no imperative way to set
// Recharts' hover — the store is private and only read-only hooks are exported
// (the dead ends are catalogued in useTouchHoverHandoff.js). The one proven
// lever is the one that hook already uses: dispatch a DOM event Recharts is
// listening for. It dispatches `mouseout`; we dispatch `mousemove` at a
// computed clientX. That dispatch is ui/crosshairDispatch.js — shared with
// useEdgeDrag rather than written out twice, since it is the only thing that
// works and every comment on it is load-bearing.
//
// useTouchHoverHandoff stays exactly as it is; its job is orthogonal and still
// required. The synthetic mousemove below gives the touched panel its own
// hover, which is precisely the state that outranks incoming syncId events —
// and the handoff is what releases the panel that was holding one before.
import { useCallback, useEffect, useRef } from 'react'
import { crosshairClientX, plotRectOf } from './chartGeometry.js'
import { moveCrosshairTo } from './crosshairDispatch.js'

// Travel before the gesture commits to an axis. A thumb never holds still, so
// without a threshold a "tap" would scrub by whatever it wobbled.
const SCRUB_SLOP_PX = 8

/**
 * @param {object} [args]
 * @param {number} [args.rightInset] - width of the derivative axis gutter, when
 *   the stack has one (ui/chartGeometry.js). The plot is that much narrower
 *   than the surface, and the clamp below is a clamp INTO THE PLOT.
 * @returns {(node: Element | null) => (() => void) | undefined}
 */
export function useTouchScrub({ rightInset = 0 } = {}) {
  // Same latest-ref discipline as the other hooks on this node, for the same
  // reason: the ref callback below keeps a `[]` dep array, so closing over
  // `rightInset` directly would re-key the callback on a checkbox click and
  // tear all four listeners down — potentially mid-gesture.
  const latest = useRef({ rightInset })
  useEffect(() => {
    latest.current = { rightInset }
  })

  const gesture = useRef({
    /**
     * Decided once per gesture and never revisited.
     *   idle   — finger down, direction not yet decided
     *   scrub  — horizontal intent; we own the gesture
     *   scroll — vertical intent; hands off, the page scrolls
     *   off    — not ours (≥2 fingers, or a touch that started on chrome).
     *            TERMINAL until every finger lifts, so a pinch can't decay back
     *            into a scrub when one of its fingers is raised.
     * @type {'idle' | 'scrub' | 'scroll' | 'off'}
     */
    mode: 'off',
    startX: 0,
    startY: 0,
    /** Where the crosshair was when the finger landed — the whole point of the
     *  gesture is that every move is measured from here, not from the finger. */
    anchorX: 0,
    /** @type {{left: number, width: number} | null} */
    plotRect: null,
    /** @type {Element | null} */
    wrapper: null,
  })

  return useCallback((node) => {
    if (!node) return undefined
    const g = gesture.current

    function abandon() {
      g.mode = 'off'
      g.wrapper = null
      g.plotRect = null
    }

    /** The gesture's own binding of ui/crosshairDispatch.js's mousemove, over
     *  the wrapper and plot rect measured once at touchstart. */
    function dispatchMove(clientX) {
      return moveCrosshairTo(g.wrapper, g.plotRect, clientX)
    }

    /** ≥2 fingers is a page zoom, and it has to stay one. Bailing out of the
     *  scrub is not enough on its own: usePinchZoom used to stop these events
     *  in the capture phase as a side effect of owning the pinch, and without
     *  that Recharts' own onTouchMove drags the crosshair to the fingers while
     *  the page magnifies under them. So: stopPropagation, capture phase, and
     *  DELIBERATELY NO preventDefault — cancelling here would kill the browser
     *  zoom, which is the whole gesture we are handing over. */
    function stopMultiTouch(e) {
      e.stopPropagation()
    }

    function handleTouchStart(e) {
      // A pinch is the BROWSER's page zoom now, not ours. Reached both by a
      // two-finger start and by a second finger landing mid-scrub.
      if (e.touches.length > 1) {
        abandon()
        stopMultiTouch(e)
        return
      }
      // Same guard as useTouchHoverHandoff: the toolbar, every panel head with
      // its checkboxes, and the absolutely-positioned Reset zoom button all
      // live inside .chart-stack, and none of them are a chart.
      const wrapper = [...node.querySelectorAll('.recharts-wrapper')].find((w) => w.contains(e.target))
      if (!wrapper) {
        abandon()
        return
      }
      // Measured ONCE per gesture and cached: plotRectOf forces layout. The
      // touched wrapper, not the stack — it is the panel being driven, and
      // §7 guarantees every panel's plot area aligns pixel-for-pixel anyway,
      // which is also why rightInset is stack-wide.
      const plotRect = plotRectOf(wrapper, latest.current.rightInset)
      if (!plotRect) {
        abandon()
        return
      }
      const touch = e.touches[0]
      g.mode = 'idle'
      g.wrapper = wrapper
      g.plotRect = plotRect
      g.startX = touch.clientX
      g.startY = touch.clientY
      // Where the crosshair already is — or, if there is none on screen, the
      // finger. THE BOOTSTRAP is the one and only case where a touch places the
      // crosshair absolutely: there is nothing to preserve, and putting it
      // under the first touch is what makes the gesture discoverable. Every
      // touch after that is relative.
      const anchorX = crosshairClientX(wrapper) ?? touch.clientX
      // Dispatched even when it lands the crosshair exactly where it already
      // is, which reads like a no-op and is not. useTouchHoverHandoff clears
      // every OTHER panel's hover on this same touchstart, and if the panel it
      // cleared was the one holding the hover, that panel emits a sync event
      // with `active: false` that cascade-clears the rest — the crosshair would
      // vanish on a tap. Re-asserting it here makes the TOUCHED panel the
      // owner, which is exactly the state the handoff hands over.
      g.anchorX = dispatchMove(anchorX)
      e.stopPropagation()
    }

    function handleTouchMove(e) {
      // A one-finger gesture that is not ours keeps its default behaviour
      // completely — but a multi-touch one still has to be kept away from
      // Recharts, and `off` is terminal, so that check comes first.
      if (e.touches.length > 1) {
        abandon()
        stopMultiTouch(e)
        return
      }
      if (g.mode === 'off') return
      // Jump path (1). In the capture phase, so React's root delegation — and
      // therefore Recharts' onTouchMove — never sees it. Done for `scroll` too:
      // a vertical read-through must not drag the crosshair to the finger
      // either.
      e.stopPropagation()

      const touch = e.touches[0]
      const dx = touch.clientX - g.startX
      const dy = touch.clientY - g.startY
      if (g.mode === 'idle') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SCRUB_SLOP_PX) return
        // DOMINANCE, not `dx !== 0` — the same reasoning as panPixels in
        // useWheelPan. A real thumb never travels a straight line, and
        // reacting to any horizontal component at all would make a vertical
        // read-through drag the crosshair sideways.
        g.mode = Math.abs(dx) > Math.abs(dy) ? 'scrub' : 'scroll'
      }
      if (g.mode !== 'scrub') return
      // Only once a scrub is certain, so an undecided or vertical gesture keeps
      // its default behaviour. As well as suppressing the scroll this is what
      // stops Safari and Chrome turning a horizontal swipe into a
      // back-navigation, which would throw away the loaded activity — the same
      // hazard useWheelPan's own preventDefault documents.
      e.preventDefault()
      dispatchMove(g.anchorX + dx)
    }

    function handleTouchEnd(e) {
      // Jump path (2): cancelling touchend is what suppresses the
      // compatibility mousemove/mousedown/click the browser would otherwise
      // synthesize at the tap point. Only for gestures that were ours, and
      // nothing inside .recharts-wrapper is clickable, so nothing is lost.
      if (g.mode === 'idle' || g.mode === 'scrub') e.preventDefault()
      // Nothing clears the crosshair here, deliberately: it must stay put after
      // the finger lifts so the numbers can be read (useTouchHoverHandoff).
      if (e.touches.length === 0) abandon()
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true })
    node.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true })
    // preventDefault on touchend needs a non-passive listener too, and browsers
    // default touchend to passive on some paths.
    node.addEventListener('touchend', handleTouchEnd, { passive: false })
    node.addEventListener('touchcancel', handleTouchEnd, { passive: false })

    return () => {
      node.removeEventListener('touchstart', handleTouchStart, { capture: true })
      node.removeEventListener('touchmove', handleTouchMove, { capture: true })
      node.removeEventListener('touchend', handleTouchEnd)
      node.removeEventListener('touchcancel', handleTouchEnd)
      abandon()
    }
    // A CALLBACK ref, not an object ref + useEffect, for the same reason as the
    // other two hooks on this node: ChartStack early-returns null before an
    // activity loads, so an effect keyed on [] would run once against a div
    // that doesn't exist, bail, and never re-run when the activity arrives.
    // The dep array must stay [] — everything mutable is read through `latest`.
  }, [])
}
