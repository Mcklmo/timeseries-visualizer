// The two DOM events that drive Recharts' crosshair from outside Recharts.
//
// There is no imperative way to set the hover: the store is private and only
// read-only hooks are exported (the dead ends are catalogued in
// useTouchHoverHandoff.js). The one proven lever is to dispatch an event the
// library is already listening for. Both halves of that lever live here rather
// than in the hook that happened to need each one first, because they now have
// two callers apiece — useTouchScrub and useEdgeDrag move the crosshair,
// useTouchHoverHandoff and useEdgeDrag release the other panels — and a second
// copy of either would be a second thing to keep in step with recharts@3.10.1's
// internals.
import { clampFraction, fractionAcross } from './chartGeometry.js'

/**
 * Put the crosshair at a client x, clamped into the plot, and report where it
 * actually landed.
 *
 * THE CLAMP IS MANDATORY, not cosmetic: mouseMoveMiddleware dispatches
 * mouseLeaveChart() when the pointer resolves outside the plot rect (via
 * isInCartesianRange), so dragging past the end would *delete* the crosshair
 * instead of stopping at it. Its bounds are inclusive, so clamping exactly to
 * the edges is safe. It reuses clampFraction + fractionAcross rather than
 * introducing pixel literals — chartGeometry.js exists so 56/4/12/44 have
 * exactly one home.
 *
 * `onMouseMove` dispatches mouseMoveAction directly with no preceding mouseover
 * needed (chart/RechartsWrapper.js), and the library already rAF-throttles
 * mousemove (state/eventSettingsSlice.js) — so there is deliberately NO second
 * rAF layer around this.
 *
 * @param {Element} wrapper - the panel's .recharts-wrapper
 * @param {{left: number, width: number}} plotRect
 * @param {number} clientX
 * @returns {number} the clamped client x the crosshair landed on
 */
export function moveCrosshairTo(wrapper, plotRect, clientX) {
  const x = plotRect.left + clampFraction(fractionAcross(clientX, plotRect)) * plotRect.width
  const rect = wrapper.getBoundingClientRect()
  wrapper.dispatchEvent(
    new MouseEvent('mousemove', {
      // Required: React delegates at the root, and getRelativeCoordinate
      // resolves against event.currentTarget — so the event has to be
      // dispatched ON the wrapper and has to reach the root from there.
      bubbles: true,
      clientX: x,
      // The wrapper's vertical middle, NOT the finger's. A finger below the
      // plot — over the bottom panel's axis ticks, say — is out of cartesian
      // range and would clear the crosshair on the spot. The middle is always
      // in range.
      clientY: rect.top + rect.height / 2,
    }),
  )
  return x
}

/**
 * Release every panel's own hover except `keepWrapper`'s, by synthesizing the
 * mouse-leave that touch never sends.
 *
 * A panel holding a stale self-hover renders its own old index and silently
 * discards every sync event syncId sends it — the full mechanism, and the three
 * dead ends that do NOT work instead of this, are in useTouchHoverHandoff.js.
 * `mouseLeaveChart` clears only the active flags, so a released panel's
 * `syncInteraction.sourceViewBox` survives and it still won't emit a
 * counter-sync that cascade-clears the rest.
 *
 * @param {Element} node - the .chart-stack, and the relatedTarget React's
 *   EnterLeave plugin walks up to
 * @param {Element | null} keepWrapper - the panel taking the hover over, which
 *   must keep it: clearing it too would wipe the readout on a gesture that
 *   never moves, since nothing would follow to restore it
 */
export function releaseOtherHovers(node, keepWrapper) {
  for (const wrapper of node.querySelectorAll('.recharts-wrapper')) {
    if (wrapper === keepWrapper) continue
    wrapper.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: node }))
  }
}
