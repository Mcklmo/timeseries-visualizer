import { describe, it, expect } from 'vitest'
import {
  EXPIRY_SKEW_MS,
  STRAVA_TOKENS_STORAGE_KEY,
  createStravaTokenStore,
  isExpired,
} from './stravaTokenStore.js'

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, String(v)),
    removeItem: (k) => entries.delete(k),
  }
}

const tokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_800_000_000_000,
  athleteId: 12345,
}

const stored = (extra) => JSON.stringify({ v: 1, ...tokens, ...extra })

describe('createStravaTokenStore', () => {
  it('round-trips the whole triple as one JSON payload under one key', () => {
    const storage = fakeStorage()
    const store = createStravaTokenStore(storage)

    expect(store.save(tokens)).toBe(true)

    expect([...storage.entries.keys()]).toEqual([STRAVA_TOKENS_STORAGE_KEY])
    expect(store.read()).toEqual(tokens)
    expect(createStravaTokenStore(storage).read()).toEqual(tokens) // survives a fresh store
  })

  // The refresh token rotates: every refresh returns a new one and kills the
  // one that was sent. Failing to persist it means reconnecting from scratch.
  it('replaces the refresh token wholesale on save, never merging', () => {
    const storage = fakeStorage({ [STRAVA_TOKENS_STORAGE_KEY]: stored() })
    const store = createStravaTokenStore(storage)

    store.save({ ...tokens, accessToken: 'access-2', refreshToken: 'refresh-2' })

    expect(store.read()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' })
  })

  it('really removes the tokens on clear', () => {
    const storage = fakeStorage({ [STRAVA_TOKENS_STORAGE_KEY]: stored() })
    const store = createStravaTokenStore(storage)

    store.clear()

    expect(storage.entries.has(STRAVA_TOKENS_STORAGE_KEY)).toBe(false)
    expect(store.read()).toBeNull()
  })

  it('reads "not connected" from an empty or unreachable storage', () => {
    expect(createStravaTokenStore(fakeStorage()).read()).toBeNull()
    expect(createStravaTokenStore(null).read()).toBeNull()
  })
})

// localStorage is hand-editable and can hold a payload written by an older
// schema. A malformed one surviving would send a garbage bearer token to the
// Worker and read to the athlete as "Strava rejected your login".
describe('read validates rather than merely parsing', () => {
  it.each([
    ['not JSON at all', '{nope'],
    ['a wrong schema version', JSON.stringify({ ...tokens, v: 99 })],
    ['no version', JSON.stringify(tokens)],
    ['a missing access token', stored({ accessToken: undefined })],
    ['an empty access token', stored({ accessToken: '' })],
    ['a missing refresh token', stored({ refreshToken: undefined })],
    // A non-finite expiry makes every comparison false, which reads as "never
    // expires" — the one wrong answer, so it is refused rather than repaired.
    ['a non-numeric expiry', stored({ expiresAt: 'soon' })],
    ['a null expiry', stored({ expiresAt: null })],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
  ])('refuses %s', (_label, payload) => {
    const store = createStravaTokenStore(fakeStorage({ [STRAVA_TOKENS_STORAGE_KEY]: payload }))
    expect(store.read()).toBeNull()
  })

  it('tolerates a missing athleteId, which a refresh response has no way to supply', () => {
    const store = createStravaTokenStore(
      fakeStorage({ [STRAVA_TOKENS_STORAGE_KEY]: stored({ athleteId: undefined }) }),
    )
    expect(store.read()).toMatchObject({ accessToken: 'access-1', athleteId: null })
  })
})

// Refreshing a minute early costs one extra call every six hours. Not doing it
// produces a 401 mid-request that looks to the athlete like a revoked grant.
describe('isExpired', () => {
  const expiresAt = 1_800_000_000_000
  const live = { ...tokens, expiresAt }

  it('is false well before expiry', () => {
    expect(isExpired(live, expiresAt - 60 * 60 * 1000)).toBe(false)
  })

  it('is true at and after the expiry instant', () => {
    expect(isExpired(live, expiresAt)).toBe(true)
    expect(isExpired(live, expiresAt + 1)).toBe(true)
  })

  it('is true inside the skew window, before the token has actually expired', () => {
    expect(isExpired(live, expiresAt - EXPIRY_SKEW_MS + 1)).toBe(true)
    expect(isExpired(live, expiresAt - EXPIRY_SKEW_MS - 1)).toBe(false)
  })

  // The caller's next step is the same either way, and returning false for
  // "nothing stored" would be a trap.
  it('treats absent tokens as expired', () => {
    expect(isExpired(null)).toBe(true)
    expect(isExpired(undefined)).toBe(true)
  })
})
