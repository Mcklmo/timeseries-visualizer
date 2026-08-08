// THE dependency-injection boundary — see ARCHITECTURE.md §5. No component
// ever imports an adapter directly; everything talks to this shape, injected
// via ActivitySourceProvider. Swapping mock -> tcx -> intervals changes only
// the instance passed to the provider.
import { createContext, createElement, useContext } from 'react'

/**
 * Which remote account an `{type:'id'}` ref belongs to. **Required on the ref**
 * — an id alone is not enough to dispatch on once there is more than one
 * provider, and the failure mode of guessing is loading from the wrong
 * athlete's account, which is worth making unrepresentable rather than
 * unlikely. sourceRegistry.js throws on an id ref that omits it.
 * @typedef {'intervals'|'strava'} ActivityProvider
 */

/**
 * `name` is optional and purely additive: nothing that produces a file ref can
 * fill it in, because neither FIT nor TCX carries a title (§8) — so `Activity.name`
 * is inferred by deriveWorkoutName. A provider *does* know the real title,
 * and tapping "Tempo 5×1k" only to land on a chart headed "Morning Run" reads
 * as a bug. Every consumer must still work without it.
 *
 * `startedAtUtc` is optional and additive in the same way, following the exact
 * precedent `name` set. It is the activity's true instant as an ISO string,
 * carried from the picker row so an adapter that receives *relative* sample
 * offsets — Strava's `time` stream is seconds from the start — can rebuild
 * absolute timestamps without a second API request. Deliberately spelled the
 * same on the ref and on ActivityRow, so the two can never come to mean
 * different things in two files. Providers that hand back a file with real
 * timestamps in it (intervals.icu) neither send nor need it.
 *
 * @typedef {{ type: 'file', file: File }} FileActivityRef
 * @typedef {{ type: 'id', provider: ActivityProvider, id: string, name?: string,
 *             startedAtUtc?: string }} IdActivityRef
 * @typedef {FileActivityRef | IdActivityRef} ActivityRef
 */

/**
 * @typedef {object} ActivitySource
 * @property {'tcx'|'fit'|'gpx'|'intervals'|'strava'|'registry'|'mock'} kind
 * @property {(ref: ActivityRef) => Promise<import('../domain/types.js').Activity>} load
 */

const ActivitySourceContext = createContext(undefined)

/**
 * Publishes an ActivitySource instance on context. Swapping mock -> tcx ->
 * intervals is exactly: change the `source` instance passed here, nothing else.
 * @param {{ source: ActivitySource, children: import('react').ReactNode }} props
 */
export function ActivitySourceProvider({ source, children }) {
  return createElement(ActivitySourceContext.Provider, { value: source }, children)
}

/** @returns {ActivitySource} */
export function useActivitySource() {
  const source = useContext(ActivitySourceContext)
  if (source === undefined) {
    throw new Error('useActivitySource must be used within an ActivitySourceProvider')
  }
  return source
}
