// Fetches basemap tiles from this app's own origin and hands back decoded
// bitmaps. The only networked module in `src/map/`, and the only place the
// route map touches `fetch` at all.
//
// **`fetch` + `createImageBitmap`, NOT `new Image()`.** Three things the old
// idiom cannot do and this feature needs all of:
//
//  · A real `AbortSignal`. Setting `img.src = ''` is the closest an <img> gets
//    to cancelling, it is not specified to stop the transfer, and it fires a
//    spurious `error`. Panning between activities with the basemap on would
//    leave a dozen requests in flight per switch.
//  · Decoding off the main thread. `createImageBitmap` returns an already
//    decoded bitmap; an <img> decodes lazily inside the first `drawImage`,
//    i.e. on the frame that draws it.
//  · An honest failure. An <img> reports every failure as one untyped `error`
//    event, so a 429 from our own rate limiter is indistinguishable from a
//    404 — and the first is worth backing off from while the second never
//    will be.
//
// **The URL is same-origin and the provider is a path segment, never a host.**
// The upstream table lives in worker/routes/tiles.js. See map/basemapRegistry.js
// for why: hiding the athlete's IP from the tile provider is the entire point
// of the proxy, and a bundle that names no third-party host cannot be edited
// into pointing at one.
import { tileKey } from './tileMath.js'

/**
 * How many decoded bitmaps to hold.
 *
 * A full-route fit is ~10-30 tiles at one zoom, so this is roughly four to
 * twelve activities' worth — enough to make flicking back and forth between
 * two rides free, and bounded so a long session cannot accumulate bitmaps
 * without limit. Bitmaps hold real GPU-side memory and are NOT collected
 * promptly by the GC, which is why eviction calls `close()` rather than
 * trusting the reference to drop.
 */
export const DEFAULT_CACHE_LIMIT = 128

/** Same-origin, always. The provider is a path segment the Worker validates
 *  against its own allowlist. */
export const TILES_PATH_PREFIX = '/api/tiles/'

/** @param {string} provider @param {{z: number, x: number, y: number}} tile */
export function tileUrl(provider, { z, x, y }) {
  return `${TILES_PATH_PREFIX}${provider}/${z}/${x}/${y}.png`
}

/**
 * @param {object} [deps] - injected for tests, matching the `fetchImpl` seam
 *   used in worker/lib/stravaProxy.js and src/lib/feedbackClient.js
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(blob: Blob) => Promise<ImageBitmap>} [deps.decode]
 * @param {number} [deps.limit]
 *
 * Both defaults go through `globalThis` at CALL time rather than capturing the
 * bare identifiers. Two reasons, and both bite:
 *   · `createImageBitmap` does not exist in jsdom, and a bare reference in a
 *     default parameter would throw a ReferenceError the moment this factory
 *     was called — before any tile was ever requested, and therefore even with
 *     the basemap switched off.
 *   · `vi.stubGlobal('fetch', …)` is how App.test.jsx pins the no-network
 *     default. A captured reference would slip past that stub.
 */
export function createTileLoader({
  fetchImpl = (...args) => globalThis.fetch(...args),
  decode = (blob) => globalThis.createImageBitmap(blob),
  limit = DEFAULT_CACHE_LIMIT,
} = {}) {
  /**
   * key -> bitmap. A plain Map used as an LRU: JS Maps iterate in insertion
   * order, so "delete then set on every hit" keeps the most recently used at
   * the end and makes the first key of `keys()` the eviction candidate. No
   * linked list, no library.
   */
  const cache = new Map()

  /**
   * key -> in-flight promise. Deduping matters more than it looks: the same
   * tile is routinely requested twice within a frame — once by the initial
   * paint and once by the resize the first paint triggers — and two identical
   * requests would double the load on a rate-limited proxy for no benefit.
   */
  const inFlight = new Map()

  const controllers = new Set()

  function touch(key) {
    const bitmap = cache.get(key)
    if (bitmap === undefined) return undefined
    cache.delete(key)
    cache.set(key, bitmap)
    return bitmap
  }

  function store(key, bitmap) {
    cache.set(key, bitmap)
    while (cache.size > limit) {
      const oldest = cache.keys().next().value
      const evicted = cache.get(oldest)
      cache.delete(oldest)
      // ImageBitmap holds memory outside the JS heap; dropping the reference
      // frees it eventually, closing it frees it now.
      evicted?.close?.()
    }
  }

  return {
    /** An already-decoded tile, or undefined. Synchronous on purpose: the draw
     *  path runs through this and must never await. */
    get(provider, tile) {
      return touch(tileKey(provider, tile))
    },

    /**
     * Ensure a tile is on its way, and resolve once it is drawable.
     *
     * Resolves to `null` rather than rejecting on any failure — a missing tile
     * is a blank square under a route that is still perfectly readable, and the
     * map must never be able to take the panel down with it. Aborts resolve to
     * null too, which is what makes the caller's "draw whatever arrived" loop
     * total.
     *
     * @returns {Promise<ImageBitmap|null>}
     */
    async load(provider, tile) {
      const key = tileKey(provider, tile)
      const cached = touch(key)
      if (cached !== undefined) return cached

      const pending = inFlight.get(key)
      if (pending) return pending

      const controller = new AbortController()
      controllers.add(controller)

      // Declared and assigned in two steps rather than `const request = …`: the
      // `finally` below reads this binding, and on the one path where fetchImpl
      // throws SYNCHRONOUSLY that read happens before the assignment. `let`
      // reads as undefined there — a `const` would throw a TDZ ReferenceError
      // out of the finally and turn this module's "never rejects" contract into
      // an unhandled rejection at every call site.
      let request
      request = (async () => {
        try {
          const response = await fetchImpl(tileUrl(provider, tile), { signal: controller.signal })
          if (!response.ok) return null
          // A 200 whose body is not an image. The shape that matters is Vite's
          // SPA fallback under `npm run dev`, which answers /api/tiles/… with
          // index.html at HTTP 200 — `ok` is true, and without this check the
          // only symptom is `decode` rejecting into the catch below and a map
          // that stays silently blank. Missing headers are NOT a failure: the
          // check only fires on a content-type we can positively see is wrong.
          const type = response.headers?.get?.('content-type')
          if (type && !type.startsWith('image/')) return null
          const bitmap = await decode(await response.blob())
          store(key, bitmap)
          return bitmap
        } catch {
          // Abort, transport failure and an undecodable body are the same
          // answer to the caller: there is no tile here. Nothing is logged —
          // a user scrolling away mid-load is not an error, and the console
          // noise would be per tile.
          return null
        } finally {
          // Only ever evict the entry THIS request still owns. `abort()` clears
          // the whole map, and a newer load() for the same tile may already
          // have registered its own promise by the time an aborted request's
          // `finally` finally runs — deleting blindly would evict that newer
          // entry and silently break the dedupe every caller depends on.
          if (inFlight.get(key) === request) inFlight.delete(key)
          controllers.delete(controller)
        }
      })()

      inFlight.set(key, request)
      return request
    },

    /**
     * Abandon everything in flight. Called on unmount and whenever the fit
     * changes, so tiles for a superseded view never land — the panel's own
     * generation counter is what makes that safe, this is what makes it cheap.
     */
    abort() {
      for (const controller of controllers) controller.abort()
      controllers.clear()
      // ⚠️ The dedupe map has to go with them, and this is not bookkeeping
      // tidiness — it is the whole reason the basemap used to paint nothing.
      // `fetch` rejects an aborted request ASYNCHRONOUSLY, so the `finally`
      // that unregisters each key has not run yet and every entry here is
      // still present but already doomed to resolve to null. The panel's
      // relayout path aborts and re-requests the same tiles in the same
      // synchronous block (ui/MapPanel.jsx), so leaving them would hand that
      // second pass the promises this call just killed — no fetch, no bitmap,
      // no repaint, and nothing left to trigger another attempt.
      inFlight.clear()
    },

    /** Test seam: how many bitmaps are held. */
    get size() {
      return cache.size
    },
  }
}
