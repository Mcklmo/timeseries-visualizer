// Hands the crosshair over between panels on touch, by synthesizing the
// mouse-leave that touch never sends.
//
// THE BUG THIS EXISTS FOR: drag a finger across one graph, lift, then drag a
// different one — the graph you just left freezes at its last point and
// ignores the shared cursor, while every other panel keeps syncing.
//
// WHY, in Recharts 3.10.1 (each <LineChart> owns a private redux store):
//   (a) A touchmove runs `setMouseOverAxisIndex` on the touched panel, which
//       sets that panel's OWN `axisInteraction.hover.active = true`.
//   (b) A panel's own hover strictly outranks incoming sync:
//       `combineTooltipInteractionState` returns the mouse interaction as soon
//       as it is active and never looks at `syncInteraction` below it. So a
//       panel holding a stale self-hover renders its own old index and
//       silently discards every sync event syncId="activity" sends it.
//   (c) Nothing clears that hover on touch. `mouseLeaveChart()` — the only
//       action that sets `hover.active = false` — is dispatched from exactly
//       two places in the library: React's `onMouseLeave` on
//       `.recharts-wrapper`, and a *mouse*move landing outside the plot area.
//       `onTouchEnd` dispatches nothing and `touchcancel` is unhandled. On
//       desktop the stale hover clears itself the moment the pointer crosses
//       into another panel; on touch it never does.
//
// THE FIX: do explicitly at touchstart what a mouse does implicitly at
// mouseleave. Recharts exposes no dispatch, but it already listens for the
// event we need — so dispatch a bubbling `mouseout` whose `relatedTarget` is
// the stack. React's EnterLeave plugin walks from the wrapper up to that
// common ancestor, fires `onMouseLeave` on the wrapper, and Recharts clears
// its own hover; the panel then falls through to `syncInteraction` (fact (b),
// one branch further down) and follows the finger again. `mouseLeaveChart`
// clears only the active flags, so the panel's `syncInteraction.sourceViewBox`
// survives and it still won't emit a counter-sync that cascade-clears the rest.
//
// Nothing is cleared on touchend, deliberately: the crosshair must stay put
// after the finger lifts so the numbers can be read. The stale panel is
// released only when another panel is touched.
//
// DEAD ENDS — do not "simplify" this into one of them:
//   - A controlled <Tooltip active defaultIndex={i}>. Fact (b) returns before
//     `defaultIndex` is ever consulted, and once a panel has been touched its
//     `hasBeenActivePreviously` is permanently true, so that branch is
//     unreachable forever after.
//   - `dispatchTouchEvents={false}`. A real RechartsWrapper prop, but
//     `CategoricalChart` passes a fixed prop list and never forwards it.
//   - Reaching the store directly. Recharts exports read-only hooks only; there
//     is no public dispatch.
import { useCallback } from 'react'

export function useTouchHoverHandoff() {
  return useCallback((node) => {
    if (!node) return undefined

    function handleTouchStart(e) {
      // Two or more fingers is a pinch, owned by usePinchZoom — it suppresses
      // Recharts' tooltip pipeline itself and nothing here should interfere.
      if (e.touches.length > 1) return
      const wrappers = [...node.querySelectorAll('.recharts-wrapper')]
      // A touch that lands on chrome rather than on a chart hands the crosshair
      // to nobody, so it releases nobody. The stack contains real controls now
      // — the toolbar row and every panel's head — and without this, tapping a
      // checkbox would clear the readout the previous touch placed, which is
      // the very thing the frozen-after-lift behaviour below exists to keep.
      if (!wrappers.some((wrapper) => wrapper.contains(e.target))) return
      for (const wrapper of wrappers) {
        // The panel being touched keeps its hover: clearing it too would wipe
        // the readout on a tap that never moves, since no touchmove would
        // follow to restore it.
        if (wrapper.contains(e.target)) continue
        wrapper.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: node }))
      }
    }

    // Capture phase is safe alongside usePinchZoom's handleMultiTouch, which is
    // registered on this same node with capture and calls stopPropagation() at
    // ≥2 touches: stopPropagation does not affect other listeners on the same
    // target, and we bail at >1 touch anyway. `passive` is honest — this
    // handler never calls preventDefault.
    node.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true })

    return () => node.removeEventListener('touchstart', handleTouchStart, { capture: true })
    // A CALLBACK ref, for the same reason as usePinchZoom: ChartStack
    // early-returns null before an activity loads, so an effect keyed on []
    // would run once against a div that doesn't exist and never re-run.
  }, [])
}
