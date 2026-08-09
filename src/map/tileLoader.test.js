import { describe, it, expect, vi } from 'vitest'
import { createTileLoader, tileUrl } from './tileLoader.js'

const TILE = { z: 3, x: 1, y: 2 }

/** A bitmap double that records its own disposal, since eviction has to close
 *  them — ImageBitmap holds memory outside the JS heap. */
function fakeBitmap(label) {
  return { label, closed: false, close() { this.closed = true } }
}

function harness({ ok = true, decode } = {}) {
  const fetchImpl = vi.fn(async () => ({ ok, blob: async () => ({}) }))
  const decodeImpl = decode ?? vi.fn(async () => fakeBitmap('tile'))
  return { fetchImpl, decodeImpl, loader: createTileLoader({ fetchImpl, decode: decodeImpl }) }
}

describe('tileUrl', () => {
  // Same-origin, provider as a path segment. The upstream host lives only in
  // the Worker — see map/basemapRegistry.js.
  it('addresses this app’s own origin, never a tile host', () => {
    expect(tileUrl('standard', TILE)).toBe('/api/tiles/standard/3/1/2.png')
  })
})

describe('createTileLoader', () => {
  it('fetches, decodes and returns a bitmap', async () => {
    const { loader, fetchImpl } = harness()
    const bitmap = await loader.load('standard', TILE)

    expect(fetchImpl).toHaveBeenCalledWith('/api/tiles/standard/3/1/2.png', expect.objectContaining({ signal: expect.anything() }))
    expect(bitmap.label).toBe('tile')
  })

  it('serves a cached tile without touching the network', async () => {
    const { loader, fetchImpl } = harness()
    await loader.load('standard', TILE)
    await loader.load('standard', TILE)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(loader.get('standard', TILE).label).toBe('tile')
  })

  it('exposes cached tiles synchronously, since the draw path cannot await', () => {
    const { loader } = harness()
    expect(loader.get('standard', TILE)).toBeUndefined()
  })

  // The same tile is routinely asked for twice inside one frame — once by the
  // first paint and once by the resize that paint triggers.
  it('dedupes concurrent requests for the same tile', async () => {
    const { loader, fetchImpl } = harness()
    const [a, b] = await Promise.all([loader.load('standard', TILE), loader.load('standard', TILE)])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('keeps providers apart at the same coordinate', async () => {
    const { loader, fetchImpl } = harness()
    await loader.load('standard', TILE)
    await loader.load('satellite', TILE)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  // A missing tile is a blank square under a route that still reads perfectly.
  // The map must never be able to take the panel down with it.
  it('answers null for a non-ok response rather than throwing', async () => {
    const { loader } = harness({ ok: false })
    await expect(loader.load('standard', TILE)).resolves.toBeNull()
  })

  it('answers null when the transport fails', async () => {
    const loader = createTileLoader({
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    await expect(loader.load('standard', TILE)).resolves.toBeNull()
  })

  it('answers null when the body will not decode', async () => {
    const { loader } = harness({
      decode: async () => {
        throw new Error('not an image')
      },
    })
    await expect(loader.load('standard', TILE)).resolves.toBeNull()
  })

  it('retries a tile that failed rather than caching the failure', async () => {
    const { loader, fetchImpl } = harness({ ok: false })
    await loader.load('standard', TILE)
    await loader.load('standard', TILE)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  // THE regression. This exact sequence — abort, then immediately re-request
  // the same tiles in the same synchronous block — is what MapPanel's relayout
  // does on every basemap change, and it used to leave the map permanently
  // blank: `fetch` rejects an aborted request asynchronously, so the dedupe
  // entry was still registered and the second load() was handed back the
  // promise the abort had just doomed. No second request, no bitmap, no
  // repaint, and nothing left to try again.
  it('re-requests a tile after aborting it, rather than re-serving the doomed promise', async () => {
    let calls = 0
    const bitmap = fakeBitmap('second attempt')
    const fetchImpl = vi.fn((_url, { signal }) => {
      calls += 1
      if (calls === 1) {
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
      }
      return Promise.resolve({ ok: true, blob: async () => ({}) })
    })
    const loader = createTileLoader({ fetchImpl, decode: async () => bitmap })

    const first = loader.load('standard', TILE)
    loader.abort()
    const second = loader.load('standard', TILE)

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBe(bitmap)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  // The other half of that fix: the aborted request's `finally` runs LATE, long
  // after the replacement has registered itself, and must not evict an entry it
  // no longer owns — that would silently break the dedupe above.
  it('keeps deduping while an aborted request is still unwinding', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
      }
      return new Promise(() => {}) // never settles: the entry stays in flight
    })
    const loader = createTileLoader({ fetchImpl })

    const aborted = loader.load('standard', TILE)
    loader.abort()
    loader.load('standard', TILE)
    await aborted // let the aborted request's finally run

    loader.load('standard', TILE)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  // A 200 whose body is not an image — Vite's SPA fallback answering
  // /api/tiles/… with index.html under `npm run dev`. Without this the only
  // symptom is a silently blank basemap.
  it('answers null for a 200 that is not an image', async () => {
    const decode = vi.fn(async () => fakeBitmap('never'))
    const loader = createTileLoader({
      fetchImpl: async () => ({
        ok: true,
        headers: { get: (name) => (name === 'content-type' ? 'text/html; charset=utf-8' : null) },
        blob: async () => ({}),
      }),
      decode,
    })

    await expect(loader.load('standard', TILE)).resolves.toBeNull()
    expect(decode).not.toHaveBeenCalled()
  })

  it('aborts what is in flight', async () => {
    let seenSignal
    const loader = createTileLoader({
      fetchImpl: (_url, { signal }) => {
        seenSignal = signal
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
      },
    })

    const pending = loader.load('standard', TILE)
    loader.abort()

    expect(seenSignal.aborted).toBe(true)
    await expect(pending).resolves.toBeNull()
  })

  describe('the LRU', () => {
    const tileAt = (x) => ({ z: 5, x, y: 0 })

    it('evicts the least recently used, and closes what it evicts', async () => {
      const evicted = fakeBitmap('first')
      const bitmaps = [evicted, fakeBitmap('second'), fakeBitmap('third')]
      let i = 0
      const loader = createTileLoader({
        fetchImpl: async () => ({ ok: true, blob: async () => ({}) }),
        decode: async () => bitmaps[i++],
        limit: 2,
      })

      await loader.load('standard', tileAt(0))
      await loader.load('standard', tileAt(1))
      await loader.load('standard', tileAt(2))

      expect(loader.size).toBe(2)
      expect(loader.get('standard', tileAt(0))).toBeUndefined()
      // Closed, not merely dereferenced: a bitmap's memory lives outside the JS
      // heap and is not reclaimed promptly by dropping the reference.
      expect(evicted.closed).toBe(true)
    })

    it('counts a cache hit as a use, so a hot tile is not evicted', async () => {
      const bitmaps = [fakeBitmap('a'), fakeBitmap('b'), fakeBitmap('c')]
      let i = 0
      const loader = createTileLoader({
        fetchImpl: async () => ({ ok: true, blob: async () => ({}) }),
        decode: async () => bitmaps[i++],
        limit: 2,
      })

      await loader.load('standard', tileAt(0))
      await loader.load('standard', tileAt(1))
      loader.get('standard', tileAt(0)) // touched — now the most recent
      await loader.load('standard', tileAt(2))

      expect(loader.get('standard', tileAt(0))).toBeDefined()
      expect(loader.get('standard', tileAt(1))).toBeUndefined()
    })
  })
})
