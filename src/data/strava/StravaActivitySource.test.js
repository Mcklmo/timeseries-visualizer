import { describe, it, expect, vi } from 'vitest'
import { StravaActivitySource } from './StravaActivitySource.js'
import { createStreamCache } from './streamCache.js'

const REF = {
  type: 'id',
  provider: 'strava',
  id: '9001',
  startedAtUtc: '2026-03-01T08:00:00Z',
  sportType: 'Run',
}

/** A short but complete stream set, in Strava's key_by_type shape. */
function streamSet({ length = 12, cadence = true } = {}) {
  const range = (fn) => Array.from({ length }, (_, i) => fn(i))
  const streams = {
    time: { data: range((i) => i * 5) },
    distance: { data: range((i) => i * 15) },
    altitude: { data: range(() => 12) },
    heartrate: { data: range(() => 150) },
    watts: { data: range(() => 240) },
    velocity_smooth: { data: range(() => 3) },
    latlng: { data: range((i) => [57.048 + i * 0.001, 9.9187]) },
  }
  if (cadence) streams.cadence = { data: range(() => 85) }
  return streams
}

function stubFetch(streams = streamSet()) {
  return vi.fn(async () => new Response(JSON.stringify(streams), { headers: { 'content-type': 'application/json' } }))
}

const makeSource = (overrides = {}) =>
  new StravaActivitySource({
    getAccessToken: async () => 'access-1',
    fetchImpl: stubFetch(),
    ...overrides,
  })

describe('StravaActivitySource', () => {
  it('has kind "strava"', () => {
    expect(makeSource().kind).toBe('strava')
  })

  it('refuses a file ref', async () => {
    await expect(makeSource().load({ type: 'file', file: new File([''], 'x.fit') })).rejects.toThrow(/id/i)
  })

  it('turns streams into a normalized Activity', async () => {
    const activity = await makeSource().load(REF)

    expect(activity).toMatchObject({ sport: 'running', startTime: new Date('2026-03-01T08:00:00Z') })
    expect(activity.samples).toHaveLength(12)
    expect(activity.availableMetrics).toEqual(
      expect.arrayContaining(['pace', 'speed', 'heartRate', 'power', 'cadence', 'altitude']),
    )
  })

  // The end-to-end version of the cadence trap: half-cadence is what an
  // athlete would actually see on the chart if the doubling were lost.
  it('charts a run’s cadence at ~170, not ~85', async () => {
    const activity = await makeSource().load(REF)
    expect(activity.samples[0].cadence).toBe(170)
  })

  it('does not double a ride’s cadence', async () => {
    const activity = await makeSource().load({ ...REF, sportType: 'Ride' })
    expect(activity.sport).toBe('cycling')
    expect(activity.samples[0].cadence).toBe(85)
  })

  it('resolves the sport before assembly, from the ref’s sportType', async () => {
    const activity = await makeSource().load({ ...REF, sportType: 'TrailRun' })
    expect(activity.sport).toBe('running')
    // The humanized type feeds sportLabel, which reaches the derived name —
    // never the title, which would produce "Morning Tempo 5×1k".
    expect(activity.name).toMatch(/trail run/i)
  })

  describe('credentials', () => {
    it('refuses without a token, before any request', async () => {
      const fetchImpl = stubFetch()
      const source = makeSource({ getAccessToken: async () => null, fetchImpl })

      await expect(source.load(REF)).rejects.toMatchObject({ code: 'not_connected' })
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    // Read at call time, never captured — so a Disconnect takes effect on the
    // very next load rather than at the next reload.
    it('reads the token thunk on every load', async () => {
      const getAccessToken = vi.fn(async () => 'access-1')
      const source = makeSource({ getAccessToken })

      await source.load(REF)
      await source.load({ ...REF, id: '9002' })

      expect(getAccessToken).toHaveBeenCalledTimes(2)
    })
  })

  describe('the start instant', () => {
    // Strava's `time` stream is offsets from the start, so without a real
    // instant there is nothing to add them to. Fetching the detail to learn it
    // would be a second request per activity opened.
    it('rebuilds absolute timestamps from the ref, with no second request', async () => {
      const fetchImpl = stubFetch()
      const activity = await makeSource({ fetchImpl }).load(REF)

      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(activity.startTime.toISOString()).toBe('2026-03-01T08:00:00.000Z')
    })

    it.each([undefined, '', 'not a date'])('refuses a ref whose startedAtUtc is %j', async (startedAtUtc) => {
      const fetchImpl = stubFetch()
      const source = makeSource({ fetchImpl })

      await expect(source.load({ ...REF, startedAtUtc })).rejects.toThrow(/start time/i)
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })

  describe('the title seam', () => {
    it('applies the real Strava title over the derived name', async () => {
      const activity = await makeSource().load({ ...REF, name: 'Tempo 5×1k' })
      expect(activity.name).toBe('Tempo 5×1k')
    })

    // Applied after normalize, so it is outside the content fingerprint: the
    // same activity is one entry whether or not the picker had a title.
    it('does not change the activity id', async () => {
      const source = makeSource()
      const withTitle = await source.load({ ...REF, name: 'Tempo 5×1k' })
      const without = await source.load(REF)

      expect(withTitle.id).toBe(without.id)
    })

    it('keeps the derived name when there is no title', async () => {
      const activity = await makeSource().load(REF)
      expect(activity.name).toMatch(/run/i)
    })
  })

  describe('the stream cache', () => {
    it('does not re-fetch an activity already loaded', async () => {
      const fetchImpl = stubFetch()
      const source = makeSource({ fetchImpl })

      await source.load(REF)
      await source.load(REF)

      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('still fetches a different activity', async () => {
      const fetchImpl = stubFetch()
      const source = makeSource({ fetchImpl })

      await source.load(REF)
      await source.load({ ...REF, id: '9002' })

      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    // A failed load must not poison the cache — "Try again" has to be able to
    // reach the network.
    it('caches nothing when the fetch fails', async () => {
      let attempt = 0
      const fetchImpl = vi.fn(async () => {
        attempt += 1
        if (attempt === 1) return new Response('{}', { status: 500 })
        return new Response(JSON.stringify(streamSet()), { headers: { 'content-type': 'application/json' } })
      })
      const source = makeSource({ fetchImpl })

      await expect(source.load(REF)).rejects.toBeTruthy()
      await expect(source.load(REF)).resolves.toBeTruthy()
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('uses an injected cache, so Disconnect can clear it', async () => {
      const cache = createStreamCache()
      const fetchImpl = stubFetch()
      const source = makeSource({ cache, fetchImpl })

      await source.load(REF)
      expect(cache.size).toBe(1)

      cache.clear()
      await source.load(REF)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })
  })

  it('propagates a StravaApiError untouched, so ErrorState renders its message', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }))

    const error = await makeSource({ fetchImpl })
      .load(REF)
      .catch((e) => e)

    expect(error.code).toBe('not_found')
    expect(error.message).toMatch(/no longer exists/i)
  })
})
