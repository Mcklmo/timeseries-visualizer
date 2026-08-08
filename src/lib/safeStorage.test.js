import { afterEach, describe, it, expect } from 'vitest'
import { createSafeStorage, localStorageOrNull, sessionStorageOrNull } from './safeStorage.js'

/** The Storage surface this module uses, over a Map. */
function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  }
}

/** A storage whose every method throws — Safari private mode's setItem, and
 *  the hardened configurations that refuse reads too. */
function hostileStorage() {
  const boom = () => {
    throw new DOMException('QuotaExceededError')
  }
  return { getItem: boom, setItem: boom, removeItem: boom }
}

describe('createSafeStorage', () => {
  it('round-trips strings and JSON through the injected storage', () => {
    const safe = createSafeStorage(fakeStorage())

    expect(safe.setString('a', 'hello')).toBe(true)
    expect(safe.getString('a')).toBe('hello')

    expect(safe.setJson('b', { n: 1, list: ['x'] })).toBe(true)
    expect(safe.getJson('b')).toEqual({ n: 1, list: ['x'] })
  })

  it('really removes a key rather than blanking it', () => {
    const storage = fakeStorage({ a: 'hello' })
    createSafeStorage(storage).remove('a')
    expect(storage.entries.has('a')).toBe(false)
  })

  // `|| null`, not `?? null`. Three stores relied on this before the extraction
  // — a blank credential is not a credential — so it is the contract here.
  it('reads an empty stored value as absent', () => {
    expect(createSafeStorage(fakeStorage({ a: '' })).getString('a')).toBeNull()
  })

  it('reads unparseable JSON as absent rather than throwing', () => {
    const safe = createSafeStorage(fakeStorage({ a: '{not json' }))
    expect(() => safe.getJson('a')).not.toThrow()
    expect(safe.getJson('a')).toBeNull()
  })

  // The Safari-private-mode case: reads work, writes throw. Losing the write
  // must not lose the app.
  it('reports a refused write as false instead of throwing', () => {
    const safe = createSafeStorage(hostileStorage())

    expect(safe.setString('a', 'hello')).toBe(false)
    expect(safe.setJson('a', { n: 1 })).toBe(false)
    expect(safe.getString('a')).toBeNull()
    expect(safe.getJson('a')).toBeNull()
    expect(() => safe.remove('a')).not.toThrow()
  })

  it('degrades to "nothing stored" with no storage at all', () => {
    for (const absent of [null, undefined]) {
      const safe = createSafeStorage(absent)
      expect(safe.getString('a')).toBeNull()
      expect(safe.getJson('a')).toBeNull()
      expect(safe.setString('a', 'hello')).toBe(false)
      expect(safe.setJson('a', { n: 1 })).toBe(false)
      expect(() => safe.remove('a')).not.toThrow()
    }
  })

  // Nothing this app stores can produce one, but the module's whole promise is
  // that no call throws — including the serialisation half of setJson.
  it('reports an unserialisable value as false instead of throwing', () => {
    const cyclic = {}
    cyclic.self = cyclic
    expect(createSafeStorage(fakeStorage()).setJson('a', cyclic)).toBe(false)
  })
})

// The guard that has to run *before* any get or set: some hardened browser
// configurations throw on reading the `localStorage` property itself.
describe('localStorageOrNull / sessionStorageOrNull', () => {
  const restore = []
  afterEach(() => {
    while (restore.length) restore.pop()()
  })

  /** @param {'localStorage'|'sessionStorage'} name */
  function makePropertyThrow(name) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error('SecurityError: access to storage is denied')
      },
    })
    restore.push(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else delete globalThis[name]
    })
  }

  it('returns the real storage when the browser allows it', () => {
    expect(localStorageOrNull()).toBe(globalThis.localStorage)
    expect(sessionStorageOrNull()).toBe(globalThis.sessionStorage)
  })

  it('returns null when reading the property itself throws', () => {
    makePropertyThrow('localStorage')
    makePropertyThrow('sessionStorage')

    expect(localStorageOrNull()).toBeNull()
    expect(sessionStorageOrNull()).toBeNull()
  })
})
