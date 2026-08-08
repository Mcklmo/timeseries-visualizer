import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  IntervalsApiError,
  INTERVALS_API_BASE,
  downloadOriginalFile,
  fetchProfile,
  listActivities,
  searchActivities,
  toApiDate,
} from './intervalsApi.js'

const API_KEY = 's3cr3t-key-value'

function jsonResponse(body, init) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/** @returns {[typeof fetch, () => {url: URL, init: RequestInit}]} */
function stubFetch(response) {
  const calls = []
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: new URL(url), rawUrl: url, init })
    return typeof response === 'function' ? response() : response
  })
  return [fetchImpl, () => calls]
}

/** The point of the header is what it decodes back to, not its literal bytes. */
function decodedAuth(init) {
  const header = init.headers.authorization
  expect(header.startsWith('Basic ')).toBe(true)
  return atob(header.slice('Basic '.length))
}

describe('intervalsApi request shape', () => {
  it('authenticates as the literal username API_KEY over HTTP Basic', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse({ id: 'i123' }))

    await fetchProfile({ apiKey: API_KEY, fetchImpl })

    expect(decodedAuth(calls()[0].init)).toBe(`API_KEY:${API_KEY}`)
  })

  // credentials:'include' would fail outright — intervals.icu sends no
  // Access-Control-Allow-Credentials — and any header outside the allowed set
  // (origin, authorization, accept, content-type, x-requested-with) starts
  // failing preflight. Both are pinned here rather than discovered in prod.
  it('omits credentials and sends no header outside the CORS-allowed set', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse({}))

    await fetchProfile({ apiKey: API_KEY, fetchImpl })

    const { init } = calls()[0]
    expect(init.credentials).toBe('omit')
    expect(init.method).toBe('GET')
    expect(Object.keys(init.headers).map((h) => h.toLowerCase()).sort()).toEqual([
      'accept',
      'authorization',
    ])
  })

  it('reads the profile from athlete 0, the "me" sentinel', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse({ id: 'i123', name: 'A Runner' }))

    const profile = await fetchProfile({ apiKey: API_KEY, fetchImpl })

    expect(calls()[0].url.pathname).toBe('/api/v1/athlete/0/profile')
    expect(profile).toEqual({ id: 'i123', name: 'A Runner' })
  })

  // `oldest` is required by the API. `newest` defaults to now and *excludes
  // its own day* (newest=2026-05-30 means ...T00:00:00), so the rolling browse
  // window leaves it out entirely — sending today's date there would silently
  // drop everything recorded today.
  it('always sends oldest, and omits newest when the caller gave none', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await listActivities({ apiKey: API_KEY, oldest: '2026-05-09', fetchImpl })

    const { url } = calls()[0]
    expect(url.origin + url.pathname).toBe(`${INTERVALS_API_BASE}/athlete/0/activities`)
    expect(url.searchParams.get('oldest')).toBe('2026-05-09')
    expect(url.searchParams.has('newest')).toBe(false)
    expect(url.searchParams.has('limit')).toBe(false)
  })

  // Passed through verbatim, with no adjustment here: because of that same
  // midnight-at-the-start rule, the +1 day an inclusive end date needs is the
  // caller's job, done once in activityDateRange.js's requestBoundsFor. Two
  // places quietly adding a day would be a day too many.
  it('sends newest verbatim when the caller does give one', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await listActivities({ apiKey: API_KEY, oldest: '2026-03-01', newest: '2026-04-01', fetchImpl })

    const { url } = calls()[0]
    expect(url.searchParams.get('oldest')).toBe('2026-03-01')
    expect(url.searchParams.get('newest')).toBe('2026-04-01')
  })

  it('asks only for the fields a picker row renders', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await listActivities({ apiKey: API_KEY, oldest: '2026-05-09', fetchImpl })

    const fields = calls()[0].url.searchParams.get('fields').split(',')
    expect(fields).toContain('id')
    expect(fields).toContain('name')
    expect(fields).toContain('start_date_local')
    expect(fields).toContain('file_type')
    expect(fields).toContain('source')
  })

  it('returns the activity array, and an empty list for a non-array body', async () => {
    const rows = [{ id: 'i1' }, { id: 'i2' }]
    const [listFetch] = stubFetch(jsonResponse(rows))
    await expect(listActivities({ apiKey: API_KEY, oldest: '2026-05-09', fetchImpl: listFetch })).resolves.toEqual(rows)

    const [oddFetch] = stubFetch(jsonResponse({ error: 'nope' }))
    await expect(listActivities({ apiKey: API_KEY, oldest: '2026-05-09', fetchImpl: oddFetch })).resolves.toEqual([])
  })

  // /search-full, not /search: only the full row carries source, file_type and
  // device_name, which the picker needs to grey out Strava rows and to credit
  // Garmin. See searchActivities' own comment.
  it('searches the whole history from the full-row endpoint, with no date window', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await searchActivities({ apiKey: API_KEY, query: 'tempo', fetchImpl })

    const { url } = calls()[0]
    expect(url.origin + url.pathname).toBe(`${INTERVALS_API_BASE}/athlete/0/activities/search-full`)
    expect(url.searchParams.get('q')).toBe('tempo')
    expect(url.searchParams.get('limit')).toBe('30')
    expect(url.searchParams.has('oldest')).toBe(false)
    expect(url.searchParams.has('newest')).toBe(false)
    // This endpoint has no `fields` projection — ACTIVITY_LIST_FIELDS is for
    // /activities only, and sending it here would be cargo cult.
    expect(url.searchParams.has('fields')).toBe(false)
  })

  // A leading # is an exact tag search *server-side*, so it has to survive as
  // a literal # in the query value. Pasting the query into the URL rather than
  // going through searchParams would make it a fragment and send `q=`.
  it('encodes a #tag query and a space rather than truncating or dropping them', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await searchActivities({ apiKey: API_KEY, query: '#tempo run', fetchImpl })

    expect(calls()[0].rawUrl).toContain('q=%23tempo+run')
    expect(calls()[0].url.searchParams.get('q')).toBe('#tempo run')
  })

  it('honours an explicit limit', async () => {
    const [fetchImpl, calls] = stubFetch(jsonResponse([]))

    await searchActivities({ apiKey: API_KEY, query: 'tempo', limit: 5, fetchImpl })

    expect(calls()[0].url.searchParams.get('limit')).toBe('5')
  })

  it('returns the hits, and an empty list for a non-array body', async () => {
    const rows = [{ id: 'i1' }, { id: 'i2' }]
    const [hitFetch] = stubFetch(jsonResponse(rows))
    await expect(searchActivities({ apiKey: API_KEY, query: 'x', fetchImpl: hitFetch })).resolves.toEqual(rows)

    const [oddFetch] = stubFetch(jsonResponse({ error: 'nope' }))
    await expect(searchActivities({ apiKey: API_KEY, query: 'x', fetchImpl: oddFetch })).resolves.toEqual([])
  })

  it('throws the same coded error as any other call when the key is rejected', async () => {
    const [fetchImpl] = stubFetch(new Response('', { status: 401 }))

    const error = await searchActivities({ apiKey: API_KEY, query: 'x', fetchImpl }).catch((e) => e)

    expect(error).toBeInstanceOf(IntervalsApiError)
    expect(error.code).toBe('unauthorized')
  })

  it('downloads the original file as bytes from the activity file endpoint', async () => {
    const payload = new Uint8Array([1, 2, 3, 4])
    const [fetchImpl, calls] = stubFetch(new Response(payload, { status: 200 }))

    const bytes = await downloadOriginalFile({ apiKey: API_KEY, activityId: 'i123', fetchImpl })

    expect(calls()[0].url.pathname).toBe('/api/v1/activity/i123/file')
    expect(bytes).toEqual(payload)
  })

  it('escapes an activity id rather than pasting it into the path', async () => {
    const [fetchImpl, calls] = stubFetch(new Response(new Uint8Array([1]), { status: 200 }))

    await downloadOriginalFile({ apiKey: API_KEY, activityId: 'i1/../../evil', fetchImpl })

    expect(calls()[0].url.pathname).toBe('/api/v1/activity/i1%2F..%2F..%2Fevil/file')
  })

  it('reports an empty download as a missing original file, not as unreadable bytes', async () => {
    const [fetchImpl] = stubFetch(new Response(new Uint8Array(0), { status: 200 }))

    await expect(
      downloadOriginalFile({ apiKey: API_KEY, activityId: 'i123', fetchImpl }),
    ).rejects.toMatchObject({ code: 'no_original_file' })
  })
})

describe('intervalsApi failure mapping', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'unexpected'],
    [502, 'unexpected'],
    [418, 'unexpected'],
  ])('maps HTTP %i to code %s', async (status, code) => {
    const [fetchImpl] = stubFetch(new Response('', { status }))

    const error = await fetchProfile({ apiKey: API_KEY, fetchImpl }).catch((e) => e)

    expect(error).toBeInstanceOf(IntervalsApiError)
    expect(error.code).toBe(code)
    expect(error.message).toBeTruthy()
  })

  // A CORS refusal and being offline are indistinguishable from here — both
  // surface as a bare TypeError from fetch. See the module header.
  it('maps a thrown fetch to network', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await listActivities({ apiKey: API_KEY, oldest: '2026-05-09', fetchImpl }).catch((e) => e)

    expect(error).toBeInstanceOf(IntervalsApiError)
    expect(error.code).toBe('network')
  })

  it('maps a body that is not JSON to unexpected rather than crashing', async () => {
    const [fetchImpl] = stubFetch(new Response('<html>gateway</html>', { status: 200 }))

    await expect(fetchProfile({ apiKey: API_KEY, fetchImpl })).rejects.toMatchObject({ code: 'unexpected' })
  })

  it('rejects a key btoa cannot encode as unauthorized, without throwing a DOMException', async () => {
    const fetchImpl = vi.fn()

    const error = await fetchProfile({ apiKey: 'kéy-with-emoji-🔑', fetchImpl }).catch((e) => e)

    expect(error).toBeInstanceOf(IntervalsApiError)
    expect(error.code).toBe('unauthorized')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // The regression that matters most: whatever else changes here, the key
  // must never reach a URL, a message, or a thrown object's own properties.
  it('never leaks the key into a URL, a message or a thrown error', async () => {
    const leaks = (value) => JSON.stringify(value ?? null).includes(API_KEY)

    for (const status of [401, 403, 404, 429, 500]) {
      const [fetchImpl, calls] = stubFetch(new Response('', { status }))

      const error = await listActivities({ apiKey: API_KEY, oldest: '2026-05-09', fetchImpl }).catch((e) => e)

      expect(calls()[0].rawUrl).not.toContain(API_KEY)
      expect(error.message).not.toContain(API_KEY)
      expect(error.stack ?? '').not.toContain(API_KEY)
      expect(leaks({ ...error })).toBe(false)
    }
  })
})

// oldest/newest are compared against start_date_local, so the string has to be
// the *local* calendar day. Deriving it via toISOString().slice(0,10) is UTC
// and shifts the window by a day for anyone not on UTC — dropping or
// duplicating a day's activities at the boundary. Proving that needs a machine
// whose local day differs from UTC's, so these tests supply one: V8 re-reads
// process.env.TZ on assignment, which is the only way to make the assertion
// discriminating rather than dependent on where the suite happens to run.
describe('toApiDate', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it.each([
    // zone,           local hour on 9 May,  the UTC day that instant falls on
    ['Asia/Tokyo', 0, '2026-05-08'], // ahead of UTC: local morning is still yesterday there
    ['America/Denver', 22, '2026-05-10'], // behind it: local evening is already tomorrow
  ])('uses the local calendar day, not the UTC one (%s)', (timeZone, hour, utcDay) => {
    process.env.TZ = timeZone
    // Built from components rather than passed in as a Date: a Date in the
    // table would have been constructed at collection time, under whatever
    // zone the suite started in. The utcDay assertion is the guard that the
    // zone switch really took — without it this test could pass vacuously.
    const local = new Date(2026, 4, 9, hour, 30)
    expect(local.toISOString().slice(0, 10)).toBe(utcDay)

    expect(toApiDate(local)).toBe('2026-05-09')
  })

  it('zero-pads month and day', () => {
    expect(toApiDate(new Date(2026, 0, 3, 12, 0))).toBe('2026-01-03')
    expect(toApiDate(new Date(2026, 11, 31, 12, 0))).toBe('2026-12-31')
  })
})
