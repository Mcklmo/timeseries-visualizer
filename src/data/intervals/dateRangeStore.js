// Where the intervals.icu date filter's range lives between loads.
//
// WHY THIS EXISTS: IntervalsPage seeded the range fresh on every mount, so
// narrowing the list to last March survived exactly until the tab was
// reloaded — and now that the filter is *on* by default (the last 90 days,
// see activityDateRange.js's `defaultRange`), a reload silently threw away a
// range the athlete had deliberately set and refetched a different window.
//
// sessionStorage, NOT localStorage — the opposite of the choice
// data/intervals/credentialStore.js makes next door, and the same one
// state/viewPrefsStore.js makes for the chart view. An API key is worth
// re-pasting only once a year; a date filter is worth remembering for as long
// as someone is comparing activities in one sitting and no longer. Per-tab,
// per-session scoping also means this entry bounds itself with no eviction
// policy to maintain and nothing to clean up on a shared machine.
//
// `read` VALIDATES rather than merely parsing, for the reason viewPrefsStore
// states: sessionStorage is hand-editable and can hold a payload written by an
// older schema. Here that is not defensive decoration either — an inverted
// range restored into state boots the page straight into its own "The end date
// is before the start date." error on first paint, with no request fired and
// nothing on screen explaining why.
//
// Every call is wrapped, same as both siblings: Safari's private mode throws
// on setItem, and some hardened configurations throw on touching Storage at
// all. Losing a remembered range is a shrug; taking the app down with it is not.
import { isValidRange } from './activityDateRange.js'

export const DATE_RANGE_STORAGE_KEY = 'timeseries-visualizer.intervals-icu.dateRange'

// Bumped only if the payload shape changes incompatibly. An entry that doesn't
// match is dropped, not migrated — this is cheap to recreate.
const SCHEMA_VERSION = 1

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** @typedef {import('./activityDateRange.js').DateRange} DateRange */

function browserSessionStorage() {
  // Guarded like the calls below: reading the property itself throws when
  // storage is disabled, before any get/set is ever attempted.
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

/** A stored bound is either absent or a real `YYYY-MM-DD` — the one shape the
 *  whole feature is built on. Anything else is not repaired, it is refused. */
function normalizeBound(value) {
  if (value == null) return null
  return typeof value === 'string' && DAY_PATTERN.test(value) ? value : undefined
}

/**
 * Anything at all -> a usable range, or null.
 *
 * `{ from: null, to: null }` is a legitimate stored value and round-trips: the
 * athlete can still empty both fields by hand, even though ↺ no longer
 * produces that state.
 *
 * @param {unknown} raw
 * @returns {DateRange|null}
 */
function normalizeRange(raw) {
  if (raw == null || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION) return null

  const from = normalizeBound(raw.from)
  const to = normalizeBound(raw.to)
  if (from === undefined || to === undefined) return null

  const range = { from, to }
  return isValidRange(range) ? range : null
}

/**
 * @param {Pick<Storage, 'getItem'|'setItem'>|null} [storage]
 * @returns {{read: () => DateRange|null, save: (range: DateRange) => void}}
 */
export function createDateRangeStore(storage = browserSessionStorage()) {
  return {
    /** @returns {DateRange|null} null means "nothing usable remembered" — including every failure. */
    read() {
      try {
        const stored = storage?.getItem(DATE_RANGE_STORAGE_KEY)
        return stored ? normalizeRange(JSON.parse(stored)) : null
      } catch {
        // Unreachable storage and unparseable JSON are the same answer here.
        return null
      }
    },

    save(range) {
      if (!range) return
      try {
        const payload = { v: SCHEMA_VERSION, from: range.from ?? null, to: range.to ?? null }
        storage?.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify(payload))
      } catch {
        // Quota exhausted or storage refused: the range simply isn't remembered.
      }
    },
  }
}

/** The app-wide instance. Tests inject their own storage instead. */
export const dateRangeStore = createDateRangeStore()
