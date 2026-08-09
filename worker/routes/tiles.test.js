// Route-level tests drive the real chain (validate -> rate limit -> upstream)
// and stub only the outermost edge — the injected `fetchImpl` — matching
// strava.test.js's shape. The validation half is also tested directly, because
// it is the only place a client-supplied value reaches an upstream URL.
import { describe, it, expect, vi } from 'vitest'
import { handleTilesRequest, parseTilePath, TILES_ROUTE_PREFIX } from './tiles.js'

const UPSTREAM = 'https://basemaps.cartocdn.com/light_all/12/2138/1310.png'

function makeEnv(overrides = {}) {
  return { TILES_RATE_LIMITER: { limit: async () => ({ success: true }) }, ...overrides }
}

function makeRequest(path, init = {}) {
  const { headers, ...rest } = init
  return new Request(`https://example.com${TILES_ROUTE_PREFIX}${path}`, {
    headers: { 'cf-connecting-ip': '203.0.113.7', cookie: 'session=secret', referer: 'https://example.com/', ...headers },
    ...rest,
  })
}

function stubUpstream({ ok = true, status = 200, headers = {} } = {}) {
  return vi.fn(
    async () =>
      new Response(ok ? 'PNGBYTES' : 'not found', {
        status,
        headers: { 'content-type': 'image/png', etag: '"abc"', 'set-cookie': 'tracker=1', ...headers },
      }),
  )
}

describe('parseTilePath', () => {
  it('accepts a well-formed tile for a known provider', () => {
    const tile = parseTilePath('standard/12/2138/1310.png')
    expect(tile).toMatchObject({ z: 12, x: 2138, y: 1310 })
  })

  it('rejects an unknown provider rather than passing it through', () => {
    expect(parseTilePath('satellite-pro/3/1/2.png')).toBeNull()
    // The failure this rules out is a proxy that can be repointed at any host.
    expect(parseTilePath('https:%2F%2Fevil.example.com/3/1/2.png')).toBeNull()
  })

  it('rejects a path that is not three integers and a .png', () => {
    for (const path of [
      'standard/3/1.png',
      'standard/3/1/2/4.png',
      'standard/3/1/2.jpg',
      'standard/3/1/2',
      'standard/a/1/2.png',
      'standard/3/-1/2.png',
      'standard/3/1.5/2.png',
      'standard/03/1/2.png', // no leading zeros: parseInt must not disagree with the pattern
      '',
    ]) {
      expect(parseTilePath(path), path).toBeNull()
    }
  })

  it('rejects traversal attempts in every segment', () => {
    expect(parseTilePath('../standard/3/1/2.png')).toBeNull()
    expect(parseTilePath('standard/3/1/..%2F..%2Fetc.png')).toBeNull()
  })

  // Unbounded z is an unbounded set of distinct upstream URLs — a cache-busting
  // amplifier pointed at someone else's server under our User-Agent.
  it('rejects a zoom past what the provider serves', () => {
    expect(parseTilePath('standard/19/1/2.png')).not.toBeNull()
    expect(parseTilePath('standard/20/1/2.png')).toBeNull()
  })

  it('rejects coordinates outside the 2^z grid', () => {
    expect(parseTilePath('standard/2/3/3.png')).not.toBeNull() // the 4×4 grid's last tile
    expect(parseTilePath('standard/2/4/0.png')).toBeNull()
    expect(parseTilePath('standard/2/0/4.png')).toBeNull()
    expect(parseTilePath('standard/0/1/0.png')).toBeNull()
  })
})

describe('handleTilesRequest', () => {
  it('returns the provider’s image body with a 200', async () => {
    const fetchImpl = stubUpstream()
    const response = await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(await response.text()).toBe('PNGBYTES')
  })

  it('requests the allowlisted upstream URL for that provider', async () => {
    const fetchImpl = stubUpstream()
    await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)
    expect(fetchImpl.mock.calls[0][0]).toBe(UPSTREAM)
  })

  // THE reason this proxy exists: the tile provider must never learn the
  // athlete's address, and it must not receive their cookies or referer either.
  it('forwards no client header upstream, and identifies the app', async () => {
    const fetchImpl = stubUpstream()
    await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)

    const sent = new Headers(fetchImpl.mock.calls[0][1].headers)
    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('referer')).toBeNull()
    expect(sent.get('cf-connecting-ip')).toBeNull()
    // Required by both OSM's and CARTO's terms — anonymous bulk use is the
    // documented reason for being blocked outright.
    expect(sent.get('user-agent')).toMatch(/ActivityMaxxer/)
  })

  it('asks the edge to cache the tile', async () => {
    const fetchImpl = stubUpstream()
    await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)
    expect(fetchImpl.mock.calls[0][1].cf).toEqual({ cacheEverything: true, cacheTtl: 604800 })
  })

  it('sets its own long cache policy downstream, overriding the provider’s', async () => {
    const fetchImpl = stubUpstream({ headers: { 'cache-control': 'max-age=60' } })
    const response = await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)
    expect(response.headers.get('cache-control')).toBe('public, max-age=604800, immutable')
  })

  it('never forwards the provider’s set-cookie', async () => {
    const fetchImpl = stubUpstream()
    const response = await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('rejects an invalid tile with a 400 and no upstream request at all', async () => {
    const fetchImpl = stubUpstream()
    const response = await handleTilesRequest(makeRequest('evil/3/1/2.png'), makeEnv(), fetchImpl)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a non-GET method', async () => {
    const fetchImpl = stubUpstream()
    const response = await handleTilesRequest(
      makeRequest('standard/12/2138/1310.png', { method: 'POST' }),
      makeEnv(),
      fetchImpl,
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rate-limits before reaching the provider', async () => {
    const fetchImpl = stubUpstream()
    const env = makeEnv({ TILES_RATE_LIMITER: { limit: async () => ({ success: false }) } })
    const response = await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), env, fetchImpl)

    expect(response.status).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails open when the limiter binding is missing, as local dev has none', async () => {
    const fetchImpl = stubUpstream()
    const response = await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), {}, fetchImpl)
    expect(response.status).toBe(200)
  })

  it('reports an unreachable provider as a 502 rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const response = await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)

    expect(response.status).toBe(502)
    expect((await response.json()).error).toBe('upstream_unreachable')
  })

  // The provider's error body is HTML and the client is expecting an image.
  it('does not pass a provider error body through as if it were a tile', async () => {
    const fetchImpl = stubUpstream({ ok: false, status: 404 })
    const response = await handleTilesRequest(makeRequest('standard/12/2138/1310.png'), makeEnv(), fetchImpl)

    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })
})
