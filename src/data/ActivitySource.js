// THE dependency-injection boundary — see ARCHITECTURE.md §5. No component
// ever imports an adapter directly; everything talks to this shape, injected
// via ActivitySourceProvider. Swapping mock -> tcx -> http changes only the
// instance passed to the provider.
import { createContext, createElement, useContext } from 'react'

/**
 * @typedef {{ type: 'file', file: File }} FileActivityRef
 * @typedef {{ type: 'id', id: string }} IdActivityRef
 * @typedef {FileActivityRef | IdActivityRef} ActivityRef
 */

/**
 * @typedef {object} ActivitySource
 * @property {'tcx'|'fit'|'http'|'mock'} kind
 * @property {(ref: ActivityRef) => Promise<import('../domain/types.js').Activity>} load
 */

const ActivitySourceContext = createContext(undefined)

/**
 * Publishes an ActivitySource instance on context. Swapping mock -> tcx ->
 * http is exactly: change the `source` instance passed here, nothing else.
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
