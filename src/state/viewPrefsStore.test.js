import { describe, it, expect } from 'vitest'
import { createViewPrefsStore } from './viewPrefsStore.js'
import { metricOrder } from '../metrics/metricRegistry.js'

const KEY = 'running-20260807T0712Z-3847s-3f2a9c1b'
const STORAGE_KEY = `timeseries-visualizer.chartView.${KEY}`

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

const prefs = {
  xMode: 'distance',
  enabledMetrics: ['heartRate', 'cadence'],
  enabledStats: Object.fromEntries(metricOrder.map((id) => [id, id === 'heartRate' ? ['max', 'median'] : []])),
  showMap: true,
  basemap: 'none',
}

const storedPayload = (extra) => JSON.stringify({ v: 2, ...prefs, ...extra })

describe('viewPrefsStore', () => {
  it('round-trips a saved view under its activity key', () => {
    const storage = fakeStorage()
    const store = createViewPrefsStore(storage)

    store.save(KEY, prefs)
    expect([...storage.entries.keys()]).toEqual([STORAGE_KEY])
    expect(store.read(KEY)).toEqual(prefs)
  })

  it('keeps activities independent: one key per activity, no shared map to merge', () => {
    const storage = fakeStorage()
    const store = createViewPrefsStore(storage)

    store.save(KEY, prefs)
    store.save('cycling-20260101T0900Z-1200s-deadbeef', { ...prefs, xMode: 'time' })

    expect(store.read(KEY).xMode).toBe('distance')
    expect(store.read('cycling-20260101T0900Z-1200s-deadbeef').xMode).toBe('time')
  })

  it('returns null for an activity that was never saved', () => {
    expect(createViewPrefsStore(fakeStorage()).read(KEY)).toBeNull()
  })

  it('returns null rather than throwing on corrupt JSON', () => {
    const store = createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: '{not json' }))
    expect(store.read(KEY)).toBeNull()
  })

  it('drops a payload from another schema version instead of guessing at it', () => {
    // Both directions: an entry written before the map fields existed (v1) and
    // one from a future shape (v3). Dropped, never migrated — the documented
    // policy, and the whole cost of the v1 -> v2 bump is that in-flight
    // sessions forget their toggles once.
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: storedPayload({ v: 1 }) })).read(KEY)).toBeNull()
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: storedPayload({ v: 3 }) })).read(KEY)).toBeNull()
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: JSON.stringify(prefs) })).read(KEY)).toBeNull()
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: '"a string"' })).read(KEY)).toBeNull()
  })

  it('round-trips the map panel choices', () => {
    const store = createViewPrefsStore(fakeStorage())
    store.save(KEY, { ...prefs, showMap: false, basemap: 'standard' })

    const restored = store.read(KEY)
    expect(restored.showMap).toBe(false)
    expect(restored.basemap).toBe('standard')
  })

  it('defaults the map panel on, since an activity with a route should show it', () => {
    const raw = storedPayload({ showMap: undefined })
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY).showMap).toBe(true)
  })

  it('does not coerce a non-boolean showMap, which truthiness would read backwards', () => {
    const raw = storedPayload({ showMap: 'false' })
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY).showMap).toBe(true)
  })

  // An unknown id would have the client asking the Worker for a provider it
  // does not serve, on every tile, forever.
  it('falls back to the private default for an unrecognised basemap', () => {
    const raw = storedPayload({ basemap: 'satellite-pro' })
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY).basemap).toBe('none')
  })

  // The privacy default is a product commitment, so it is pinned here as well
  // as by App.test.jsx's no-fetch assertion: nothing a stored entry can say
  // makes a fresh read come back with tiles switched on by accident.
  it('leaves the basemap off when the stored entry says nothing about it', () => {
    const raw = storedPayload({ basemap: undefined })
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY).basemap).toBe('none')
  })

  it('filters out an unknown metric id, which would otherwise throw in StatCheckboxes', () => {
    // metricRegistry['vo2max'] is undefined, and StatCheckboxes reads .label
    // off it on the very next render — this is a TypeError, not a cosmetic
    // problem, and sessionStorage is hand-editable.
    const raw = storedPayload({ enabledMetrics: ['heartRate', 'vo2max'] })
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY).enabledMetrics).toEqual(['heartRate'])
  })

  it('filters out unknown stat kinds and unknown metrics inside enabledStats', () => {
    const raw = storedPayload({ enabledStats: { heartRate: ['max', 'p95'], vo2max: ['avg'] } })
    const restored = createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY)

    expect(restored.enabledStats.heartRate).toEqual(['max'])
    expect(restored.enabledStats).not.toHaveProperty('vo2max')
  })

  it('always returns an entry for every known metric, so the caller never merges', () => {
    const raw = storedPayload({ enabledStats: { heartRate: ['max'] } })
    const restored = createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY)

    expect(Object.keys(restored.enabledStats)).toEqual(metricOrder)
    expect(restored.enabledStats.pace).toEqual([])
  })

  it('restores stats in canonical order however they were stored', () => {
    const raw = storedPayload({ enabledStats: { heartRate: ['median', 'max'] } })
    const restored = createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY)
    expect(restored.enabledStats.heartRate).toEqual(['max', 'median'])
  })

  it('round-trips a derivative kind, sorted after the scalars', () => {
    // Derivatives are just another StatKind, which is the point of keeping ONE
    // statKinds list: no migration, no SCHEMA_VERSION bump, and no second
    // "enabled derivatives" map to persist and keep in sync. `filterToKnown`
    // re-sorts into statKinds order, where d1/d2 are appended last.
    const storage = fakeStorage()
    const store = createViewPrefsStore(storage)
    const withDeriv = {
      ...prefs,
      enabledStats: { ...prefs.enabledStats, heartRate: ['max', 'median', 'd1'] },
    }

    store.save(KEY, withDeriv)
    expect(store.read(KEY).enabledStats.heartRate).toEqual(['max', 'median', 'd1'])
  })

  it('sorts a derivative behind the scalars however it was stored', () => {
    const raw = storedPayload({ enabledStats: { heartRate: ['d2', 'avg'] } })
    const restored = createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY)
    expect(restored.enabledStats.heartRate).toEqual(['avg', 'd2'])
  })

  it('keeps a stored derivative that its metric no longer offers out of the way', () => {
    // `filterToKnown` validates against the GLOBAL statKinds, not per metric,
    // so 'd1' stored against cadence survives the store — which is fine and
    // deliberate: StatCheckboxes renders statKindsFor(metric) so no box appears
    // for it, and useDerivativeSeries returns null for a metric with no
    // `derivative` spec. Pinned because the two layers have to agree.
    const raw = storedPayload({ enabledStats: { cadence: ['d1'] } })
    const restored = createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY)
    expect(restored.enabledStats.cadence).toEqual(['d1'])
  })

  it('falls back to time mode for an unrecognised xMode', () => {
    const raw = storedPayload({ xMode: 'laps' })
    expect(createViewPrefsStore(fakeStorage({ [STORAGE_KEY]: raw })).read(KEY).xMode).toBe('time')
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
    const store = createViewPrefsStore(hostile)

    expect(() => store.save(KEY, prefs)).not.toThrow()
    expect(store.read(KEY)).toBeNull()
  })

  it('degrades the same way when there is no storage at all', () => {
    const store = createViewPrefsStore(null)
    expect(() => store.save(KEY, prefs)).not.toThrow()
    expect(store.read(KEY)).toBeNull()
  })

  it('ignores a missing activity key rather than writing an entry under the bare prefix', () => {
    const storage = fakeStorage()
    const store = createViewPrefsStore(storage)

    store.save(null, prefs)
    store.save('', prefs)

    expect(storage.entries.size).toBe(0)
    expect(store.read(null)).toBeNull()
  })
})
