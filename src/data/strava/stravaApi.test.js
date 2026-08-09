import { describe, it, expect, vi } from 'vitest'
import {
  STRAVA_PROXY_BASE,
  STREAM_KEYS,
  StravaApiError,
  exchangeCode,
  fetchStreams,
  listActivities,
  readFreshAccessToken,
} from './stravaApi.js'
import { createStravaTokenStore } from './stravaTokenStore.js'

const ACCESS_TOKEN = 'access-1'

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/** @returns {[typeof fetch, () => {url: URL, init: RequestInit}[]]} */
function stubFetch(response) {
  const calls = []
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ rawUrl: String(url), url: new URL(String(url), 'https://app.example'), init })
    return typeof response === 'function' ? response(calls.length) : response
  })
  return [fetchImpl, () => calls]
}

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, String(v)),
    removeItem: (k) => entries.delete(k),
  }
}

const storeWith = (tokens) => {
  const store = createStravaTokenStore(fakeStorage())
  store.save(tokens)
  return store
}

describe('request shape', () => {
  it('talks to this app’s own Worker, same-origin and relative', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await listActivities({ accessToken: ACCESS_TOKEN, fetchImpl })

    // Relative by construction — an absolute origin here would be the first
    // step back to the CORS problem the Worker exists to remove.
    expect(calls()[0].rawUrl.startsWith(`${STRAVA_PROXY_BASE}/activities`)).toBe(true)
    expect(calls()[0].init.credentials).toBe('omit')
  })

  it('sends the athlete’s bearer token and nothing else identifying', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await listActivities({ accessToken: ACCESS_TOKEN, fetchImpl })

    expect(calls()[0].init.headers).toEqual({
      accept: 'application/json',
      authorization: `Bearer ${ACCESS_TOKEN}`,
    })
  })

  it('sets the epoch-second bounds only when given', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await listActivities({ accessToken: ACCESS_TOKEN, after: 1700000000, fetchImpl })

    const { url } = calls()[0]
    expect(url.searchParams.get('after')).toBe('1700000000')
    // A stray `undefined` would go over the wire as the string, which Strava
    // reads as 0 — i.e. "since the epoch".
    expect(url.searchParams.has('before')).toBe(false)
    expect(url.searchParams.get('per_page')).toBe('50')
  })

  it('asks for every stream this app reads, and never for moving', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse({ time: { data: [0] } }))

    await fetchStreams({ accessToken: ACCESS_TOKEN, activityId: '9001', fetchImpl })

    const keys = calls()[0].url.searchParams.get('keys').split(',')
    expect(keys).toEqual(STREAM_KEYS)
    expect(keys).not.toContain('moving')
    expect(keys).not.toContain('temp')
    expect(calls()[0].url.pathname).toBe('/api/strava/activities/9001/streams')
  })

  it('returns [] rather than throwing when the list body is not an array', async () => {
    const [fetchImpl] = stubFetch(jsonResponse({ message: 'hm' }))
    await expect(listActivities({ accessToken: ACCESS_TOKEN, fetchImpl })).resolves.toEqual([])
  })

  it('reports a non-object stream body as no_streams', async () => {
    const [fetchImpl] = stubFetch(jsonResponse(null))
    await expect(fetchStreams({ accessToken: ACCESS_TOKEN, activityId: '1', fetchImpl })).rejects.toMatchObject(
      { code: 'no_streams' },
    )
  })
})

describe('status -> code', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'unexpected'],
    [418, 'unexpected'],
  ])('maps a bare upstream %i to %s', async (status, code) => {
    const [fetchImpl] = stubFetch(new Response('{}', { status }))

    const error = await listActivities({ accessToken: ACCESS_TOKEN, fetchImpl }).catch((e) => e)

    expect(error).toBeInstanceOf(StravaApiError)
    expect(error.code).toBe(code)
    expect(error.message).toBeTruthy()
  })

  // The Worker's own failures carry the {ok:false, error} envelope; Strava's
  // arrive verbatim with no envelope. That difference is the discriminator.
  it('prefers the Worker’s own error code over the status map', async () => {
    const [fetchImpl] = stubFetch(
      jsonResponse({ ok: false, error: 'app_rate_limited', message: 'Slow down.' }, { status: 429 }),
    )

    const error = await listActivities({ accessToken: ACCESS_TOKEN, fetchImpl }).catch((e) => e)

    expect(error.code).toBe('app_rate_limited')
    expect(error.message).toBe('Slow down.')
  })

  it('surfaces athlete_cap, which can only arrive from our own Worker', async () => {
    const [fetchImpl] = stubFetch(jsonResponse({ ok: false, error: 'athlete_cap' }, { status: 400 }))

    const error = await exchangeCode({ code: 'c', fetchImpl }).catch((e) => e)

    expect(error.code).toBe('athlete_cap')
    expect(error.message).toMatch(/limited number of strava accounts/i)
  })

  it('maps a transport failure to network, not to unexpected', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await listActivities({ accessToken: ACCESS_TOKEN, fetchImpl }).catch((e) => e)

    expect(error.code).toBe('network')
  })
})

describe('readFreshAccessToken', () => {
  const future = () => Date.now() + 60 * 60 * 1000
  const past = () => Date.now() - 1000

  it('returns the stored token untouched when it is still valid', async () => {
    const [fetchImpl] = stubFetch(jsonResponse({}))
    const store = storeWith({ accessToken: 'live', refreshToken: 'r1', expiresAt: future() })

    await expect(readFreshAccessToken({ store, fetchImpl })).resolves.toBe('live')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws not_connected with nothing stored, without calling the network', async () => {
    const [fetchImpl] = stubFetch(jsonResponse({}))
    const store = createStravaTokenStore(fakeStorage())

    await expect(readFreshAccessToken({ store, fetchImpl })).rejects.toMatchObject({
      code: 'not_connected',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes an expired token and PERSISTS the rotated refresh token', async () => {
    const [fetchImpl, calls] = stubFetch(
      jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: future() }),
    )
    const store = storeWith({ accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: past(), athleteId: 7 })

    await expect(readFreshAccessToken({ store, fetchImpl })).resolves.toBe('access-2')

    expect(calls()[0].url.pathname).toBe('/api/strava/refresh')
    expect(JSON.parse(calls()[0].init.body)).toEqual({ refreshToken: 'refresh-1' })
    // The one that was sent is dead. Storing what came back is not optional.
    expect(store.read()).toMatchObject({ refreshToken: 'refresh-2', accessToken: 'access-2' })
    // A refresh response carries no athlete, so the id has to be carried across.
    expect(store.read().athleteId).toBe(7)
  })

  // T5. A picker mounting while an activity loads fires two refreshes; the
  // rotation invalidates whichever lands second, and the athlete is silently
  // signed out at a moment unrelated to anything they did.
  it('de-duplicates concurrent refreshes into a single request', async () => {
    let resolveRefresh
    const pending = new Promise((resolve) => {
      resolveRefresh = resolve
    })
    const fetchImpl = vi.fn(async () => {
      await pending
      return jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: future() })
    })
    const store = storeWith({ accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: past() })

    const both = Promise.all([
      readFreshAccessToken({ store, fetchImpl }),
      readFreshAccessToken({ store, fetchImpl }),
    ])
    resolveRefresh()

    await expect(both).resolves.toEqual(['access-2', 'access-2'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('lets a later refresh proceed after an earlier one settled', async () => {
    const [fetchImpl] = stubFetch((n) =>
      jsonResponse({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresAt: past() }),
    )
    const store = storeWith({ accessToken: 'stale', refreshToken: 'refresh-0', expiresAt: past() })

    await expect(readFreshAccessToken({ store, fetchImpl })).resolves.toBe('access-1')
    await expect(readFreshAccessToken({ store, fetchImpl })).resolves.toBe('access-2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight slot when a refresh fails, so a retry is possible', async () => {
    let attempt = 0
    const fetchImpl = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) return new Response('{}', { status: 500 })
      return jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: Date.now() + 3600_000 })
    })
    const store = storeWith({ accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: past() })

    await expect(readFreshAccessToken({ store, fetchImpl })).rejects.toBeInstanceOf(StravaApiError)
    await expect(readFreshAccessToken({ store, fetchImpl })).resolves.toBe('access-2')
  })
})
