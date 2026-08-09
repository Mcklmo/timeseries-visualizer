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
