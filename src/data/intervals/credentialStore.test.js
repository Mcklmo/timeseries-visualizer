import { describe, it, expect, vi } from 'vitest'
import { createCredentialStore, API_KEY_STORAGE_KEY } from './credentialStore.js'

/** The Storage surface this module actually uses, over a Map. */
function fakeStorage(initial = []) {
  const map = new Map(initial)
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  }
}

describe('credentialStore', () => {
  it('round-trips a key through the injected storage', () => {
    const storage = fakeStorage()
    const store = createCredentialStore(storage)

    expect(store.readApiKey()).toBeNull()
    expect(store.saveApiKey('abc123')).toBe(true)

    expect(storage.map.get(API_KEY_STORAGE_KEY)).toBe('abc123')
    expect(store.readApiKey()).toBe('abc123')
    expect(createCredentialStore(storage).readApiKey()).toBe('abc123') // survives a fresh store
  })

  it('really removes the key on clear, rather than blanking it', () => {
    const storage = fakeStorage([[API_KEY_STORAGE_KEY, 'abc123']])
    const store = createCredentialStore(storage)

    store.clearApiKey()

    expect(storage.map.has(API_KEY_STORAGE_KEY)).toBe(false)
    expect(store.readApiKey()).toBeNull()
  })

  it('reads an empty stored value as not connected', () => {
    const store = createCredentialStore(fakeStorage([[API_KEY_STORAGE_KEY, '']]))
    expect(store.readApiKey()).toBeNull()
  })

  // Safari's private mode throws on setItem, and some hardened configurations
  // throw on every Storage call. A throw inside a React event handler would
  // take the whole app down, so each call degrades to "not connected" instead.
  it('degrades to not-connected instead of throwing when storage is unusable', () => {
    const boom = () => {
      throw new Error('QuotaExceededError')
    }
    const store = createCredentialStore({ getItem: boom, setItem: boom, removeItem: boom })

    expect(store.saveApiKey('abc123')).toBe(false)
    expect(store.readApiKey()).toBeNull()
    expect(() => store.clearApiKey()).not.toThrow()
  })

  it('degrades to not-connected when there is no storage at all', () => {
    const store = createCredentialStore(null)

    expect(store.saveApiKey('abc123')).toBe(false)
    expect(store.readApiKey()).toBeNull()
    expect(() => store.clearApiKey()).not.toThrow()
  })

  it('defaults to the browser localStorage', () => {
    const store = createCredentialStore()
    try {
      expect(store.saveApiKey('default-storage-key')).toBe(true)
      expect(window.localStorage.getItem(API_KEY_STORAGE_KEY)).toBe('default-storage-key')
      expect(store.readApiKey()).toBe('default-storage-key')
    } finally {
      store.clearApiKey()
    }
    expect(window.localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull()
  })

  it('never logs the key', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = createCredentialStore(fakeStorage())
    store.saveApiKey('super-secret')
    store.readApiKey()
    store.clearApiKey()

    for (const spy of [log, warn, error]) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
