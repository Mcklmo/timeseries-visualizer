// The second of the two Strava caches, and the opposite of streamCache.js in
// every dimension that matters — which is why they are two modules and not one
// with a flag.
//
// | | streamCache | this |
// |---|---|---|
// | holds | one activity's telemetry | the picker's list of rows |
// | size | 300–600 KB each | ~10 KB total |
// | lives in | memory | sessionStorage |
// | TTL | none — streams are immutable | **15 minutes** |
//
// **sessionStorage here, memory there, and the size is the whole reason.** A
// stream set is far too large for a ~5 MB per-origin budget already shared with
// viewPrefsStore (see streamCache.js's header for what that failure looks
// like). A list of rows is small enough to be free, and surviving a reload is
// exactly what it is for: reload the tab, or come back to the picker, and the
// list is *there* rather than blank for a round trip.
//
// **15 minutes, not API Policy §6.2's seven-day ceiling.** The ceiling is a
// permission, not a target. An athlete who just uploaded a run expects to see
// it, and a list that is hours stale reads as a broken feature rather than as a
// fast one — which is a strictly worse outcome than the request it saved.
//
// **This never serves a final answer.** The hook seeds its state from here and
// then fetches anyway, so the cache removes the blank screen and nothing else;
// a row that has since been deleted on Strava survives at most one repaint.
// That is deliberate. A cache that could be the last word would need
// invalidation, and invalidation is where the 48-hour deletion obligation
// (§6.3) stops being automatic.
//
// **Policy §6.3 and §7.4 are satisfied by evaporation plus one explicit
// clear.** sessionStorage dies with the tab, and Disconnect calls `clear()`
// before deauthorizing — the ordering matters and StravaPage tests it.
import { createSafeStorage, sessionStorageOrNull } from '../../lib/safeStorage.js'

export const STRAVA_ACTIVITY_LIST_STORAGE_KEY = 'timeseries-visualizer.strava.activityList'

// Bumped only if the payload shape changes incompatibly. An entry that doesn't
// match is dropped, not migrated — one request recreates it.
const SCHEMA_VERSION = 1

/** See the header. Fifteen minutes is "the same sitting", not "recently". */
export const ACTIVITY_LIST_TTL_MS = 15 * 60_000

/**
 * The newest rows are the ones a returning athlete is looking at, and the list
 * grows without bound as they page backwards — `mergeById` only ever
 * accumulates. A cap keeps this entry from creeping toward the storage budget
 * the streams were kept out of; the rows past it cost one request to get back.
 */
export const ACTIVITY_LIST_MAX_ROWS = 100

/** @typedef {import('../activityRow.js').ActivityRow} ActivityRow */

/**
 * A stored row is refused rather than repaired if it isn't one. Everything
 * downstream — `mergeById`, `startDayOf`, `ActivityRowList`'s key — assumes a
 * string id, and sessionStorage is hand-editable.
 *
 * The other fields are deliberately *not* re-validated: they are all optional
 * by contract (see data/activityRow.js), the mapper already turned "unusable"
 * into null, and a renderer that copes with a missing distance copes with a
 * corrupted one identically.
 */
function normalizeRows(raw) {
  if (raw == null || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION) return null
  if (!Number.isFinite(raw.savedAt)) return null
  if (!Array.isArray(raw.rows)) return null

  const rows = raw.rows.filter((row) => row && typeof row.id === 'string' && row.id)
  return rows.length > 0 ? { rows, savedAt: raw.savedAt } : null
}

/**
 * **sessionStorage, deliberately** — see the header. Both the storage and the
 * clock stay factory arguments: the storage so tests inject their own, and
 * `now` because `vi.useFakeTimers()` hangs RTL's `waitFor` in this repo
 * (`globals: false` provides no `jest` global), so expiry has to be testable
 * without touching the global clock.
 *
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [storage]
 * @param {() => number} [now]
 */
export function createActivityListCache(storage = sessionStorageOrNull(), now = Date.now) {
  const safe = createSafeStorage(storage)
  return {
    /**
     * @returns {ActivityRow[]|null} null means "nothing usable" — unreachable
     *   storage, unparseable JSON, a foreign schema and an expired entry are
     *   one answer to the caller, which has the same next step for all four.
     */
    read() {
      const entry = normalizeRows(safe.getJson(STRAVA_ACTIVITY_LIST_STORAGE_KEY))
      if (!entry) return null
      // A clock that jumped backwards (a timezone change, an NTP correction)
      // makes `age` negative, which would read as "fresh forever". Both ends
      // are checked, and the entry is simply dropped.
      const age = now() - entry.savedAt
      if (age < 0 || age > ACTIVITY_LIST_TTL_MS) return null
      return entry.rows
    },

    /**
     * @param {ActivityRow[]} rows
     * @returns {boolean} false when the browser refused to persist them. The
     *   session is unaffected; the next visit just starts blank.
     */
    save(rows) {
      if (!Array.isArray(rows) || rows.length === 0) return false
      return safe.setJson(STRAVA_ACTIVITY_LIST_STORAGE_KEY, {
        v: SCHEMA_VERSION,
        savedAt: now(),
        rows: rows.slice(0, ACTIVITY_LIST_MAX_ROWS),
      })
    },

    /** Disconnect calls this, before deauthorizing. Nothing derived from the
     *  athlete's data may outlive their grant. */
    clear() {
      safe.remove(STRAVA_ACTIVITY_LIST_STORAGE_KEY)
    },
  }
}

/** The app-wide instance. Tests inject their own storage instead. */
export const activityListCache = createActivityListCache()
