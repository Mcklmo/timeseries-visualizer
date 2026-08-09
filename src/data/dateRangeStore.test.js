import { describe, it, expect } from 'vitest'
import {
  DATE_RANGE_STORAGE_KEY,
  STRAVA_DATE_RANGE_STORAGE_KEY,
  createDateRangeStore,
} from './dateRangeStore.js'

// The same Map-backed double every test drives, so what actually lands in
// storage can be asserted as a string, not just round-tripped.
function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, String(v)),
    entries,
  }
}

const range = { from: '2026-03-01', to: '2026-03-31' }

const storedPayload = (extra) => JSON.stringify({ v: 1, ...range, ...extra })

describe('dateRangeStore', () => {
  it('round-trips a range as a single JSON string under one key', () => {
    const storage = fakeStorage()
    const store = createDateRangeStore(storage)

    store.save(range)

    expect([...storage.entries.keys()]).toEqual([DATE_RANGE_STORAGE_KEY])
    expect(storage.entries.get(DATE_RANGE_STORAGE_KEY)).toBe(storedPayload())
    expect(store.read()).toEqual(range)
  })

  // One open end is a perfectly good range, and so is neither: the athlete can
  // still empty both fields by hand, even though ↺ no longer produces that.
  it('round-trips an open end, and both ends empty', () => {
    const storage = fakeStorage()
    const store = createDateRangeStore(storage)

    store.save({ from: '2026-03-01', to: null })
    expect(store.read()).toEqual({ from: '2026-03-01', to: null })

    store.save({ from: null, to: null })
    expect(store.read()).toEqual({ from: null, to: null })
  })

  it('returns null when nothing was ever saved', () => {
    expect(createDateRangeStore(fakeStorage()).read()).toBeNull()
  })

  it('returns null rather than throwing on corrupt JSON', () => {
    const store = createDateRangeStore(fakeStorage({ [DATE_RANGE_STORAGE_KEY]: '{not json' }))
    expect(store.read()).toBeNull()
  })

  it('drops a payload from another schema version instead of guessing at it', () => {
    const wrongVersion = fakeStorage({ [DATE_RANGE_STORAGE_KEY]: storedPayload({ v: 2 }) })
    expect(createDateRangeStore(wrongVersion).read()).toBeNull()
    // no `v` at all, and a scalar where an object belongs
    expect(createDateRangeStore(fakeStorage({ [DATE_RANGE_STORAGE_KEY]: JSON.stringify(range) })).read()).toBeNull()
    expect(createDateRangeStore(fakeStorage({ [DATE_RANGE_STORAGE_KEY]: '"2026-03-01"' })).read()).toBeNull()
  })

  // Everything downstream assumes two `YYYY-MM-DD` strings and compares them
  // lexicographically, so a bound that isn't one is refused rather than
  // repaired — `<input type="date">` would silently blank it anyway.
  it('drops a bound that is not a YYYY-MM-DD day', () => {
    const bad = ['2026-3-1', '01/03/2026', '2026-03-01T00:00:00', 'today', 20260301, '']
    for (const from of bad) {
      const storage = fakeStorage({ [DATE_RANGE_STORAGE_KEY]: storedPayload({ from }) })
      expect(createDateRangeStore(storage).read()).toBeNull()
    }
  })

  // Without this the page boots straight into its own "The end date is before
  // the start date." alert on first paint, with no request fired and nothing
  // on screen saying why — and sessionStorage is hand-editable.
  it('drops an inverted range instead of restoring the page into its own error', () => {
    const storage = fakeStorage({ [DATE_RANGE_STORAGE_KEY]: storedPayload({ from: '2026-03-31', to: '2026-03-01' }) })
    expect(createDateRangeStore(storage).read()).toBeNull()
  })

  it('degrades to null/no-op when storage itself throws, as Safari private mode does', () => {
    const hostile = {
      getItem() {
        throw new Error('SecurityError')
      },
      setItem() {
        throw new Error('QuotaExceededError')
      },
    }
    const store = createDateRangeStore(hostile)

    expect(() => store.save(range)).not.toThrow()
    expect(store.read()).toBeNull()
  })

  it('degrades the same way when there is no storage at all', () => {
    const store = createDateRangeStore(null)
    expect(() => store.save(range)).not.toThrow()
    expect(store.read()).toBeNull()
  })

  it('writes nothing at all for a missing range', () => {
    const storage = fakeStorage()
    createDateRangeStore(storage).save(null)
    expect(storage.entries.size).toBe(0)
  })

  // The two pickers browse two different accounts' histories. Narrowing Strava
  // to last March says nothing about what to show on intervals.icu, so the
  // ranges must not be one setting wearing two names — and sharing one key is
  // the silent version of that, where each picker overwrites the other's on
  // every keystroke.
  describe('one key per provider', () => {
    it('keeps two stores on the same storage from seeing each other', () => {
      const storage = fakeStorage()
      const intervals = createDateRangeStore(storage, DATE_RANGE_STORAGE_KEY)
      const strava = createDateRangeStore(storage, STRAVA_DATE_RANGE_STORAGE_KEY)

      intervals.save({ from: '2026-03-01', to: '2026-03-31' })
      strava.save({ from: '2025-01-01', to: '2025-12-31' })

      expect(intervals.read()).toEqual({ from: '2026-03-01', to: '2026-03-31' })
      expect(strava.read()).toEqual({ from: '2025-01-01', to: '2025-12-31' })
      expect([...storage.entries.keys()].sort()).toEqual(
        [DATE_RANGE_STORAGE_KEY, STRAVA_DATE_RANGE_STORAGE_KEY].sort(),
      )
    })

    // Pinned as a value, not just as "they differ": the intervals.icu key
    // predates this file's move up out of data/intervals/, and changing it
    // would silently discard every range remembered in a live tab.
    it('pins both key strings', () => {
      expect(DATE_RANGE_STORAGE_KEY).toBe('timeseries-visualizer.intervals-icu.dateRange')
      expect(STRAVA_DATE_RANGE_STORAGE_KEY).toBe('timeseries-visualizer.strava.dateRange')
    })
  })
})
