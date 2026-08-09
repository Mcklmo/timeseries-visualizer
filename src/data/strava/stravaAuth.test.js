import { describe, it, expect } from 'vitest'
import {
  REQUIRED_SCOPE,
  STRAVA_STATE_STORAGE_KEY,
  beginAuthorization,
  buildAuthorizeUrl,
  consumeStoredState,
  hasRequiredScope,
  readCallbackParams,
} from './stravaAuth.js'

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, String(v)),
    removeItem: (k) => entries.delete(k),
  }
}

describe('buildAuthorizeUrl', () => {
  const url = () =>
    new URL(buildAuthorizeUrl({ clientId: '99999', origin: 'https://activitymaxxer.com', state: 's-1' }))

  it('points at Strava’s own authorize endpoint', () => {
    expect(url().origin + url().pathname).toBe('https://www.strava.com/oauth/authorize')
  })

  // Strava pins only the domain, so any path is legal — and `/` is already
  // served, so this adds nothing to the Worker or the prerendered SEO pages.
  it('redirects back to the site root', () => {
    expect(url().searchParams.get('redirect_uri')).toBe('https://activitymaxxer.com/')
  })

  // activity:read silently excludes private activities, and "my run isn't in
  // the list" is a confusing failure that looks like a bug in this app.
  it('asks for activity:read_all', () => {
    expect(url().searchParams.get('scope')).toBe('activity:read_all')
    expect(REQUIRED_SCOPE).toBe('activity:read_all')
  })

  it('carries the client id, response type and state', () => {
    expect(url().searchParams.get('client_id')).toBe('99999')
    expect(url().searchParams.get('response_type')).toBe('code')
    expect(url().searchParams.get('state')).toBe('s-1')
  })
})

describe('beginAuthorization', () => {
  it('mints a state, stores it, and puts the same one in the URL', () => {
    const storage = fakeStorage()

    const authorizeUrl = beginAuthorization({
      clientId: '99999',
      origin: 'https://activitymaxxer.com',
      storage,
    })

    const stored = storage.entries.get(STRAVA_STATE_STORAGE_KEY)
    expect(stored).toBeTruthy()
    expect(new URL(authorizeUrl).searchParams.get('state')).toBe(stored)
  })

  it('mints a different state each time', () => {
    const a = beginAuthorization({ clientId: '1', origin: 'https://x.test', storage: fakeStorage() })
    const b = beginAuthorization({ clientId: '1', origin: 'https://x.test', storage: fakeStorage() })
    expect(new URL(a).searchParams.get('state')).not.toBe(new URL(b).searchParams.get('state'))
  })

  // Storage refused: the flow still runs, and consumeStoredState then finds
  // nothing and refuses the callback — the safe direction to fail in.
  it('does not throw when storage is unavailable', () => {
    expect(() => beginAuthorization({ clientId: '1', origin: 'https://x.test', storage: null })).not.toThrow()
  })
})

describe('consumeStoredState', () => {
  // Single use. A state that has been checked once is spent; leaving it would
  // let a replayed callback URL be accepted a second time.
  it('reads the state and deletes it in the same call', () => {
    const storage = fakeStorage({ [STRAVA_STATE_STORAGE_KEY]: 's-1' })

    expect(consumeStoredState(storage)).toBe('s-1')
    expect(storage.entries.has(STRAVA_STATE_STORAGE_KEY)).toBe(false)
    expect(consumeStoredState(storage)).toBeNull()
  })

  it('is null when nothing was stored, or storage is unavailable', () => {
    expect(consumeStoredState(fakeStorage())).toBeNull()
    expect(consumeStoredState(null)).toBeNull()
  })
})

describe('readCallbackParams', () => {
  it('is null on an ordinary page load — the overwhelmingly common case', () => {
    expect(readCallbackParams('')).toBeNull()
    expect(readCallbackParams('?utm_source=newsletter')).toBeNull()
  })

  it('reads an approved return', () => {
    expect(readCallbackParams('?state=s-1&code=c-1&scope=read,activity:read_all')).toEqual({
      code: 'c-1',
      state: 's-1',
      scope: 'read,activity:read_all',
      error: undefined,
    })
  })

  // A user choice, not an error state — it gets its own copy.
  it('reads a cancelled return', () => {
    expect(readCallbackParams('?state=s-1&error=access_denied')).toMatchObject({
      error: 'access_denied',
      code: undefined,
    })
  })
})

describe('hasRequiredScope', () => {
  // Strava's consent screen lets the athlete untick "View data about your
  // private activities", which produces a mysteriously short list otherwise.
  it('is true only when read_all was actually granted', () => {
    expect(hasRequiredScope('read,activity:read_all')).toBe(true)
    expect(hasRequiredScope('activity:read_all')).toBe(true)
    expect(hasRequiredScope('read,activity:read')).toBe(false)
    expect(hasRequiredScope('')).toBe(false)
    expect(hasRequiredScope(undefined)).toBe(false)
  })
})
