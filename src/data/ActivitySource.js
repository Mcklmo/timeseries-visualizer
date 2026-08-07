// THE dependency-injection boundary — see ARCHITECTURE.md §5. No component
// ever imports an adapter directly; everything talks to this shape, injected
// via ActivitySourceProvider. Swapping mock -> tcx -> intervals changes only
// the instance passed to the provider.
import { createContext, createElement, useContext } from 'react'

/**
 * `name` is optional and purely additive: nothing that produces a file ref can
 * fill it in, because neither FIT nor TCX carries a title (§8) — so `Activity.name`
 * is inferred by deriveWorkoutName. intervals.icu *does* know the real title,
 * and tapping "Tempo 5×1k" only to land on a chart headed "Morning Run" reads
 * as a bug. Every consumer must still work without it.
 * @typedef {{ type: 'file', file: File }} FileActivityRef
 * @typedef {{ type: 'id', id: string, name?: string }} IdActivityRef
 * @typedef {FileActivityRef | IdActivityRef} ActivityRef
 */

/**
 * @typedef {object} ActivitySource
 * @property {'tcx'|'fit'|'gpx'|'intervals'|'mock'} kind
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
