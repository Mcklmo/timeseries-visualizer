// Where the crosshair is, published to anything that wants to draw it outside
// React's render cycle. Module-level pub/sub, no context, no state.
//
// **WHY THIS IS NOT A CONTEXT, and please don't "simplify" it into one.**
// ChartViewContext.jsx records that `hoverIndex` was deleted from the context
// and must not return: a context write per hover frame re-renders ChartStack
// and therefore every <LineChart> under it. Today a mouse-move re-renders only
// the tooltip's own subtree (ui/CrosshairReadout.jsx portals into DOM slots),
// and the map panel has to join that arrangement rather than break it. A
// canvas marker needs no React at all — it needs a function call — so the
// subscriber draws straight to its own 2D context and nothing re-renders.
//
// This is the same shape as the DOM-slot portal already in use, one level
// further out: CrosshairReadout stays inside Recharts' hover pipeline (syncId,
// the touch handoff, `combineTooltipInteractionState`) and hands the position
// out at the edge.
//
// **`{t, d}` and not an index.** Recharts' `activeIndex` IS reachable from
// `<Tooltip content>` — verified in recharts@3.10.1, `component/Tooltip.js`
// spreads it into the props given to `renderContent` — and it is the WRONG
// index. It counts the rows MetricPanel builds, which carry the synthetic
// break rows domain/insertGapBreaks.js splices in, so it diverges from
// `activity.samples` after the first sensor dropout: every position past the
// first gap would be off by the number of gaps before it, silently, and only
// on files that have gaps. Publishing the row's own `{t, d}` and resolving it
// with `indexAtX` (domain/sliceSamples.js) costs a binary search per hover
// frame and cannot drift.
//
// Total by design: a throwing subscriber must not take the hover pipeline down
// with it, since the publisher is called from inside a React effect during a
// live gesture.

/** @typedef {{t: number, d: number}|null} CrosshairPosition */

/** @type {Set<(pos: CrosshairPosition) => void>} */
const subscribers = new Set()

/** @type {CrosshairPosition} */
let current = null

/**
 * One delivery, isolated. A broken listener must not stop the others, must not
 * throw back into the effect that published, and must not take out the mount
 * that subscribed. Logged rather than swallowed silently: it can only be our
 * own bug.
 *
 * @param {(pos: CrosshairPosition) => void} fn
 * @param {CrosshairPosition} pos
 */
function deliver(fn, pos) {
  try {
    fn(pos)
  } catch (error) {
    console.error('crosshairBus: subscriber threw', error)
  }
}

/**
 * Announce where the crosshair is, or `null` for "there is no crosshair".
 *
 * @param {CrosshairPosition} pos
 */
export function publishCrosshair(pos) {
  current = pos
  for (const fn of subscribers) deliver(fn, pos)
}

/**
 * @param {(pos: CrosshairPosition) => void} fn - called immediately with the
 *   current position, then on every change. The replay matters: a panel that
 *   mounts mid-hover (toggling a metric on, say) would otherwise draw nothing
 *   until the next pointer move.
 * @returns {() => void} unsubscribe
 */
export function subscribeCrosshair(fn) {
  subscribers.add(fn)
  deliver(fn, current)
  return () => {
    subscribers.delete(fn)
  }
}

/** The last published position. For tests and for late readers. */
export function currentCrosshair() {
  return current
}

/** Test seam only — the module-level state outlives a Testing Library
 *  `cleanup()`, so a hover left over from one test would replay into the next
 *  one's fresh mount. setupTests.js does not know about this module, so suites
 *  that publish call this themselves. */
export function resetCrosshairBus() {
  subscribers.clear()
  current = null
}
