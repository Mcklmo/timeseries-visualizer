// THE dependency-injection boundary — see ARCHITECTURE.md §5. No component
// ever imports an adapter directly; everything talks to this shape, injected
// via ActivitySourceProvider. Swapping mock -> tcx -> http changes only the
// instance passed to the provider.

/**
 * @typedef {{ type: 'file', file: File }} FileActivityRef
 * @typedef {{ type: 'id', id: string }} IdActivityRef
 * @typedef {FileActivityRef | IdActivityRef} ActivityRef
 */

/**
 * @typedef {object} ActivitySource
 * @property {'tcx'|'http'|'mock'} kind
 * @property {(ref: ActivityRef) => Promise<import('../domain/types.js').Activity>} load
 */

export {}
