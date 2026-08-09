// Route-level tests drive the *real* chain (rate limit -> oauth/proxy lib ->
// upstream) and stub only the outermost edge: `globalThis.fetch`, routed by
// URL. Mocking the lib modules instead would assert that the route calls them,
// not that the thing it produces is right — feedback.test.js's shape, exactly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleStravaRequest } from './strava.js'

const TOKEN_URL = 'https://www.strava.com/oauth/token'
const DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize'
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const STREAMS_URL = 'https://www.strava.com/api/v3/activities/9001/streams'

const CLIENT_SECRET = 'strava-client-secret-value'
const ACCESS_TOKEN = 'athlete-access-token'

// Strava's own token payload, in Strava's own spelling and units — the whole
// point of readTokens is that neither survives to the browser unchanged.
const stravaTokenPayload = {
  token_type: 'Bearer',
  expires_at: 1_800_000_000,
  expires_in: 21600,
  refresh_token: 'rotated-refresh-token',
  access_token: ACCESS_TOKEN,
  athlete: { id: 12345, username: 'runner' },
}

function makeEnv(overrides = {}) {
  return {
    STRAVA_CLIENT_ID: '99999',
    STRAVA_CLIENT_SECRET: CLIENT_SECRET,
    STRAVA_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  }
}

function makeRequest(path, init = {}) {
  const { body, headers, ...rest } = init
  return new Request(`https://example.com/api/strava/${path}`, {
    headers: { 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
    ...rest,
  })
}

const authed = (extra = {}) => ({ authorization: `Bearer ${ACCESS_TOKEN}`, ...extra })

/**
 * Stubs global fetch, routing by URL. `upstream` overrides the response for
 * the API endpoints so status pass-through can be driven per test.
 */
function stubFetch({ tokenStatus = 200, upstream, deauthorizeStatus = 200 } = {}) {
  const calls = []
  const impl = vi.fn(async (input, options) => {
    // The proxy passes a Request object; the oauth lib passes a url + init.
    const request = input instanceof Request ? input : new Request(String(input), options)
    calls.push({ url: request.url, method: request.method, headers: request.headers, options })

    if (request.url === TOKEN_URL) {
      if (tokenStatus !== 200) {
        return new Response(JSON.stringify({ message: `Bad Request: ${CLIENT_SECRET}` }), { status: tokenStatus })
      }
      return new Response(JSON.stringify(stravaTokenPayload), { status: 200 })
    }
    if (request.url === DEAUTHORIZE_URL) {
      return new Response(JSON.stringify({ access_token: ACCESS_TOKEN }), { status: deauthorizeStatus })
    }
    if (request.url.startsWith(ACTIVITIES_URL) || request.url.startsWith(STREAMS_URL)) {
      return (
        upstream ??
        new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-readratelimit-usage': '12,143' },
        })
      )
    }
    throw new Error(`unexpected fetch to ${request.url}`)
  })
  vi.stubGlobal('fetch', impl)
  return { calls, impl }
}

let consoleError

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  consoleError.mockRestore()
})

describe('POST /api/strava/token', () => {
  it('exchanges the code and returns tokens in the app’s own shape', async () => {
    const { calls } = stubFetch()

    const response = await handleStravaRequest(
      makeRequest('token', { method: 'POST', body: { code: 'auth-code-1' } }),
      makeEnv(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accessToken: ACCESS_TOKEN,
      refreshToken: 'rotated-refresh-token',
      // MILLISECONDS, not Strava's seconds. Its only consumer compares this
      // against Date.now(); seconds would read as "expired" on every call.
      expiresAt: 1_800_000_000_000,
      athlete: { id: 12345, username: 'runner' },
    })

    const sent = new URLSearchParams(calls[0].options.body)
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('code')).toBe('auth-code-1')
    // Strava does not want one on this grant, unlike most OAuth 2 servers.
    expect(sent.has('redirect_uri')).toBe(false)
  })

  it('rejects a body with no code before reaching Strava', async () => {
    const { impl } = stubFetch()

    const response = await handleStravaRequest(makeRequest('token', { method: 'POST', body: {} }), makeEnv())

    expect(response.status).toBe(400)
    expect(impl).not.toHaveBeenCalled()
  })

  it('answers a missing client secret with a generic 500', async () => {
    stubFetch()

    const response = await handleStravaRequest(
      makeRequest('token', { method: 'POST', body: { code: 'c' } }),
      makeEnv({ STRAVA_CLIENT_SECRET: undefined }),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('internal_error')
    expect(body.message).not.toMatch(/secret|client/i)
  })

  it('maps a rejected grant to a 400 the client can act on', async () => {
    stubFetch({ tokenStatus: 400 })

    const response = await handleStravaRequest(
      makeRequest('token', { method: 'POST', body: { code: 'stale-code' } }),
      makeEnv(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'invalid_grant' })
  })
})

describe('POST /api/strava/refresh', () => {
  it('returns the ROTATED refresh token, which the client must store', async () => {
    const { calls } = stubFetch()

    const response = await handleStravaRequest(
      makeRequest('refresh', { method: 'POST', body: { refreshToken: 'old-refresh-token' } }),
      makeEnv(),
    )

    await expect(response.json()).resolves.toMatchObject({ refreshToken: 'rotated-refresh-token' })
    const sent = new URLSearchParams(calls[0].options.body)
    expect(sent.get('grant_type')).toBe('refresh_token')
    expect(sent.get('refresh_token')).toBe('old-refresh-token')
  })
})

describe('POST /api/strava/deauthorize', () => {
  it('revokes the grant with the athlete’s own token and returns ok', async () => {
    const { calls } = stubFetch()

    const response = await handleStravaRequest(
      makeRequest('deauthorize', { method: 'POST', headers: authed() }),
      makeEnv(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(calls[0].url).toBe(DEAUTHORIZE_URL)
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('refuses without a bearer token, without calling Strava', async () => {
    const { impl } = stubFetch()

    const response = await handleStravaRequest(makeRequest('deauthorize', { method: 'POST' }), makeEnv())

    expect(response.status).toBe(401)
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('GET /api/strava/activities', () => {
  it('forwards the bearer token and the epoch-second bounds, clamping per_page', async () => {
    const { calls } = stubFetch()

    const request = new Request(
      'https://example.com/api/strava/activities?after=1700000000&before=1800000000&per_page=500&page=2',
      { headers: authed({ 'cf-connecting-ip': '203.0.113.7' }) },
    )
    const response = await handleStravaRequest(request, makeEnv())

    expect(response.status).toBe(200)
    const url = new URL(calls[0].url)
    expect(url.origin + url.pathname).toBe(ACTIVITIES_URL)
    expect(url.searchParams.get('after')).toBe('1700000000')
    expect(url.searchParams.get('before')).toBe('1800000000')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('100')
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('returns Strava’s body verbatim, plus the rate-limit headers', async () => {
    stubFetch()

    const response = await handleStravaRequest(makeRequest('activities', { headers: authed() }), makeEnv())

    await expect(response.json()).resolves.toEqual([{ id: 1 }])
    // Readable client-side for free, because this is same-origin — the
    // intervals.icu path cannot read its equivalents at all.
    expect(response.headers.get('x-readratelimit-usage')).toBe('12,143')
  })

  it('never forwards the client’s own headers upstream', async () => {
    const { calls } = stubFetch()

    await handleStravaRequest(
      makeRequest('activities', {
        headers: authed({ cookie: 'session=secret', 'x-custom': 'nope', referer: 'https://example.com/private' }),
      }),
      makeEnv(),
    )

    expect(calls[0].headers.get('cookie')).toBeNull()
    expect(calls[0].headers.get('x-custom')).toBeNull()
    expect(calls[0].headers.get('referer')).toBeNull()
  })

  it('never forwards Strava’s set-cookie downstream', async () => {
    stubFetch({
      upstream: new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'strava_remember=1' },
      }),
    })

    const response = await handleStravaRequest(makeRequest('activities', { headers: authed() }), makeEnv())

    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it.each([401, 429])('passes an upstream %s straight through with its body', async (status) => {
    stubFetch({
      upstream: new Response(JSON.stringify({ message: 'Authorization Error' }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    })

    const response = await handleStravaRequest(makeRequest('activities', { headers: authed() }), makeEnv())

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ message: 'Authorization Error' })
  })

  it('refuses without a bearer token', async () => {
    const { impl } = stubFetch()
    const response = await handleStravaRequest(makeRequest('activities'), makeEnv())
    expect(response.status).toBe(401)
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('GET /api/strava/activities/:id/streams', () => {
  it('requests key_by_type and never a resolution', async () => {
    const { calls } = stubFetch()

    const request = new Request(
      'https://example.com/api/strava/activities/9001/streams?keys=time,distance,heartrate',
      { headers: authed() },
    )
    await handleStravaRequest(request, makeEnv())

    const url = new URL(calls[0].url)
    expect(url.origin + url.pathname).toBe(STREAMS_URL)
    expect(url.searchParams.get('keys')).toBe('time,distance,heartrate')
    expect(url.searchParams.get('key_by_type')).toBe('true')
    // Any value at all makes Strava resample, so it is never sent.
    expect(url.searchParams.has('resolution')).toBe(false)
  })

  // The only place a client-supplied value reaches the upstream URL path.
  it.each(['../../athlete', '9001;drop', 'abc', ''])('rejects a non-numeric id (%s)', async (id) => {
    const { impl } = stubFetch()

    const request = new Request(`https://example.com/api/strava/activities/${encodeURIComponent(id)}/streams`, {
      headers: authed(),
    })
    const response = await handleStravaRequest(request, makeEnv())

    expect([400, 404]).toContain(response.status)
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('the Worker’s own guards', () => {
  // Deliberately a different code from Strava's 429: only one of the two can
  // name a real wait time, and they mean different things.
  it('answers its own rate limit with app_rate_limited, before any upstream call', async () => {
    const { impl } = stubFetch()

    const response = await handleStravaRequest(
      makeRequest('activities', { headers: authed() }),
      makeEnv({ STRAVA_RATE_LIMITER: { limit: async () => ({ success: false }) } }),
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'app_rate_limited' })
    expect(impl).not.toHaveBeenCalled()
  })

  it('404s an unknown Strava endpoint', async () => {
    stubFetch()
    const response = await handleStravaRequest(makeRequest('athlete', { headers: authed() }), makeEnv())
    expect(response.status).toBe(404)
  })

  it('405s the wrong method', async () => {
    stubFetch()
    const response = await handleStravaRequest(makeRequest('token', { headers: authed() }), makeEnv())
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })
})

// The single most important assertion in this file. Every response the route
// can produce is checked, including the failure paths, because a leak on a
// path nobody exercises is still a leak.
describe('STRAVA_CLIENT_SECRET never reaches a response body', () => {
  it.each([
    ['token happy path', { tokenStatus: 200 }],
    ['token rejected by Strava (its error body names the secret)', { tokenStatus: 400 }],
    ['token upstream 500', { tokenStatus: 500 }],
  ])('%s', async (_label, options) => {
    stubFetch(options)

    for (const request of [
      makeRequest('token', { method: 'POST', body: { code: 'c' } }),
      makeRequest('refresh', { method: 'POST', body: { refreshToken: 'r' } }),
    ]) {
      const response = await handleStravaRequest(request, makeEnv())
      const text = await response.text()
      expect(text).not.toContain(CLIENT_SECRET)
      expect([...response.headers.values()].join(' ')).not.toContain(CLIENT_SECRET)
    }
  })
})
