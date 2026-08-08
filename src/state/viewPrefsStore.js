// Where a single activity's chart-view choices live between loads: which
// stats are ticked, which metrics are on, and which x-axis mode is selected.
//
// WHY THIS EXISTS: ChartViewContext seeds itself fresh on every mount, so
// turning heart-rate max on and elevation off used to survive exactly until
// the next activity was opened. Now it survives, per activity, keyed by the
// content fingerprint from domain/activityKey.js — which is also what makes
// "the same file, dropped in or downloaded from intervals.icu" one entry
// rather than two.
//
// sessionStorage, NOT localStorage — the opposite of the choice
// data/intervals/credentialStore.js makes, for the opposite reason. An API
// key is worth re-pasting only once a year; a chart-view preference is worth
// remembering for as long as someone is comparing activities in one sitting
// and no longer. Per-tab, per-session scoping also means the growth of these
// entries bounds itself with no eviction policy to maintain and nothing to
// clean up on a shared machine.
//
// ONE ENTRY PER ACTIVITY, not one map of all of them: there is then no
// read-modify-write to get wrong, and a single corrupted entry costs one
// activity's prefs rather than everyone's.
//
// `read` VALIDATES rather than merely parsing, because sessionStorage is
// user-editable and can hold a payload written by an older schema. This is
// not defensive decoration: an unknown metric id surviving into
// `enabledMetrics` reaches `metricRegistry[metricId].label` in StatCheckboxes
// and throws a real TypeError on the next render.
//
// Every call goes through lib/safeStorage.js, same as credentialStore:
// Safari's private mode throws on setItem, and some hardened configurations
// throw on touching Storage at all. Losing a remembered view is a shrug; taking
// the app down with it is not.
import { createSafeStorage, sessionStorageOrNull } from '../lib/safeStorage.js'
import { metricOrder, statKinds } from '../metrics/metricRegistry.js'

const KEY_PREFIX = 'timeseries-visualizer.chartView.'

// Bumped only if the payload shape changes incompatibly. An entry that
// doesn't match is dropped, not migrated — these are cheap to recreate.
const SCHEMA_VERSION = 1

const X_MODES = ['time', 'distance']

/** @typedef {{xMode: import('../domain/types.js').XAxisMode,
 *             enabledMetrics: import('../domain/types.js').MetricId[],
 *             enabledStats: Record<string, import('../domain/types.js').StatKind[]>}} ViewPrefs */

/** Canonical order regardless of what order the stored array happened to be
 *  in, matching what toggleMetric/statKinds guarantee for live state. */
function filterToKnown(values, known) {
  if (!Array.isArray(values)) return null
  return known.filter((k) => values.includes(k))
}

/**
 * Anything at all -> a fully-formed prefs object, or null.
 *
 * `enabledStats` always comes back with an entry for *every* metric in
 * metricOrder, so a caller never has to merge a partial map with the defaults
 * — and a metric added to the registry after an entry was written simply
 * shows up switched off.
 *
 * @param {unknown} raw
 * @returns {ViewPrefs|null}
 */
function normalizePrefs(raw) {
  if (raw == null || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION) return null

  const enabledMetrics = filterToKnown(raw.enabledMetrics, metricOrder)
  if (enabledMetrics === null) return null

  const storedStats = raw.enabledStats
  if (storedStats == null || typeof storedStats !== 'object') return null
  const enabledStats = Object.fromEntries(
    metricOrder.map((metricId) => [metricId, filterToKnown(storedStats[metricId], statKinds) ?? []]),
  )

  return {
    xMode: X_MODES.includes(raw.xMode) ? raw.xMode : 'time',
    enabledMetrics,
    enabledStats,
  }
}

/**
 * **sessionStorage, deliberately** — see the header. The storage stays a
 * factory argument so tests inject their own.
 *
 * @param {Pick<Storage, 'getItem'|'setItem'>|null} [storage]
 * @returns {{read: (activityKey: string) => ViewPrefs|null, save: (activityKey: string, prefs: ViewPrefs) => void}}
 */
export function createViewPrefsStore(storage = sessionStorageOrNull()) {
  const safe = createSafeStorage(storage)
  return {
    /** @returns {ViewPrefs|null} null means "nothing usable remembered" —
     *  unreachable storage, unparseable JSON and a payload that fails
     *  validation are all the same answer to the caller. */
    read(activityKey) {
      if (!activityKey) return null
      return normalizePrefs(safe.getJson(KEY_PREFIX + activityKey))
    },

    save(activityKey, prefs) {
      if (!activityKey || !prefs) return
      // The `false` is dropped on purpose: quota exhausted or storage refused
      // means the view simply isn't remembered, and there is nothing the
      // caller could usefully do about it. NOTE that this is exactly the
      // swallow that would hide a QuotaExceededError caused by some *other*
      // module filling sessionStorage — so nothing large belongs in there.
      safe.setJson(KEY_PREFIX + activityKey, {
        v: SCHEMA_VERSION,
        xMode: prefs.xMode,
        enabledMetrics: prefs.enabledMetrics,
        enabledStats: prefs.enabledStats,
      })
    },
  }
}

/** The app-wide instance. Tests inject their own storage instead. */
export const viewPrefsStore = createViewPrefsStore()
