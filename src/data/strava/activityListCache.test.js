import { describe, it, expect } from 'vitest'
import {
  ACTIVITY_LIST_MAX_ROWS,
  ACTIVITY_LIST_TTL_MS,
  STRAVA_ACTIVITY_LIST_STORAGE_KEY,
  createActivityListCache,
} from './activityListCache.js'

// Map-backed so what actually lands in storage can be asserted as a string,
// matching dateRangeStore.test.js's double.
function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, String(v)),
    removeItem: (k) => entries.delete(k),
    entries,
  }
}

// A hand-cranked clock rather than vi.useFakeTimers(), which hangs RTL's
// `waitFor` in this repo — and which this module does not need anyway, since
// `now` is a constructor argument for exactly this reason.
function clock(start = 1_000_000) {
  let t = start
  return Object.assign(() => t, { advance: (ms) => (t += ms) })
}

const rows = [
  { id: '1', name: 'Tempo 5×1k', startedAt: '2026-08-08T09:00:00', startedAtUtc: '2026-08-08T07:00:00Z' },
  { id: '2', name: 'Sunday ride', startedAt: '2026-08-06T09:00:00', startedAtUtc: '2026-08-06T07:00:00Z' },
]

describe('activityListCache', () => {
  it('round-trips rows under one key', () => {
    const storage = fakeStorage()
    const cache = createActivityListCache(storage, clock())

    expect(cache.save(rows)).toBe(true)

    expect([...storage.entries.keys()]).toEqual([STRAVA_ACTIVITY_LIST_STORAGE_KEY])
    expect(cache.read()).toEqual(rows)
  })

  it('returns null when nothing was ever saved', () => {
    expect(createActivityListCache(fakeStorage(), clock()).read()).toBeNull()
  })

  describe('the 15-minute TTL', () => {
    it('serves an entry right up to the boundary', () => {
      const now = clock()
      const cache = createActivityListCache(fakeStorage(), now)
      cache.save(rows)

      now.advance(ACTIVITY_LIST_TTL_MS)
      expect(cache.read()).toEqual(rows)
    })

    // An athlete who just uploaded a run expects to see it. A list hours stale
    // reads as a broken feature, which is strictly worse than the request it
    // saved — hence a real expiry rather than §6.2's seven-day ceiling.
    it('drops it one millisecond past', () => {
      const now = clock()
      const cache = createActivityListCache(fakeStorage(), now)
      cache.save(rows)

      now.advance(ACTIVITY_LIST_TTL_MS + 1)
      expect(cache.read()).toBeNull()
    })

    // A timezone change or an NTP correction can move the clock backwards, and
    // a negative age would otherwise read as "fresh forever" — the one wrong
    // answer, and the one that never expires on its own.
    it('drops an entry from the future rather than treating it as fresh', () => {
      const now = clock()
      const cache = createActivityListCache(fakeStorage(), now)
      cache.save(rows)

      now.advance(-1)
      expect(cache.read()).toBeNull()
    })
  })

  describe('refusing a payload rather than repairing it', () => {
    it('drops corrupt JSON', () => {
      const storage = fakeStorage({ [STRAVA_ACTIVITY_LIST_STORAGE_KEY]: '{not json' })
      expect(createActivityListCache(storage, clock()).read()).toBeNull()
    })

    it('drops another schema version instead of guessing at it', () => {
      const stored = JSON.stringify({ v: 2, savedAt: 1_000_000, rows })
      const storage = fakeStorage({ [STRAVA_ACTIVITY_LIST_STORAGE_KEY]: stored })
      expect(createActivityListCache(storage, clock()).read()).toBeNull()
    })

    it('drops an entry with no usable savedAt, which would otherwise never expire', () => {
      const stored = JSON.stringify({ v: 1, rows })
      const storage = fakeStorage({ [STRAVA_ACTIVITY_LIST_STORAGE_KEY]: stored })
      expect(createActivityListCache(storage, clock()).read()).toBeNull()
    })

    // Everything downstream keys on a string id: mergeById's Set, React's key,
    // and the URL path the streams request interpolates it into.
    it('filters out rows with no string id, and drops the entry if none survive', () => {
      const mixed = [{ id: '1', name: 'kept' }, { id: 7 }, { name: 'no id' }, null]
      const storage = fakeStorage({
        [STRAVA_ACTIVITY_LIST_STORAGE_KEY]: JSON.stringify({ v: 1, savedAt: 1_000_000, rows: mixed }),
      })
      expect(createActivityListCache(storage, clock()).read()).toEqual([{ id: '1', name: 'kept' }])

      const allBad = fakeStorage({
        [STRAVA_ACTIVITY_LIST_STORAGE_KEY]: JSON.stringify({ v: 1, savedAt: 1_000_000, rows: [{ id: 7 }] }),
      })
      expect(createActivityListCache(allBad, clock()).read()).toBeNull()
    })
  })

  // The list grows without bound as the athlete pages backwards — mergeById
  // only ever accumulates — and this entry shares the budget the stream sets
  // were deliberately kept out of.
  it('caps what it writes, keeping the newest rows', () => {
    const many = Array.from({ length: ACTIVITY_LIST_MAX_ROWS + 50 }, (_, i) => ({ id: String(i) }))
    const cache = createActivityListCache(fakeStorage(), clock())

    cache.save(many)

    const held = cache.read()
    expect(held).toHaveLength(ACTIVITY_LIST_MAX_ROWS)
    expect(held[0].id).toBe('0')
    expect(held.at(-1).id).toBe(String(ACTIVITY_LIST_MAX_ROWS - 1))
  })

  it('writes nothing at all for an empty or missing list', () => {
    const storage = fakeStorage()
    const cache = createActivityListCache(storage, clock())

    expect(cache.save([])).toBe(false)
    expect(cache.save(null)).toBe(false)
    expect(storage.entries.size).toBe(0)
  })

  // The §7.4 obligation. Evaporation covers the tab closing; this covers the
  // athlete revoking the grant while the tab stays open.
  it('clears the entry on demand', () => {
    const storage = fakeStorage()
    const cache = createActivityListCache(storage, clock())
    cache.save(rows)

    cache.clear()

    expect(storage.entries.size).toBe(0)
    expect(cache.read()).toBeNull()
  })

  it('degrades to null/no-op when storage itself throws, as Safari private mode does', () => {
    const hostile = {
      getItem() {
        throw new Error('SecurityError')
      },
      setItem() {
        throw new Error('QuotaExceededError')
      },
      removeItem() {
        throw new Error('SecurityError')
      },
    }
    const cache = createActivityListCache(hostile, clock())

    expect(cache.save(rows)).toBe(false)
    expect(cache.read()).toBeNull()
    expect(() => cache.clear()).not.toThrow()
  })

  it('degrades the same way when there is no storage at all', () => {
    const cache = createActivityListCache(null, clock())
    expect(cache.save(rows)).toBe(false)
    expect(cache.read()).toBeNull()
    expect(() => cache.clear()).not.toThrow()
  })
})
