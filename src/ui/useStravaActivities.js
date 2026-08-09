// The Strava picker's whole read side — the stored tokens, the browse window,
// and the date range that drives it — the sibling useIntervalsActivities'
// header predicted.
//
// **It is that hook minus the entire search half, and that is the interesting
// difference.** Strava has no activity search endpoint at all: there is no
// query to debounce, no `results` list kept apart from `activities`, no
// `searchStatus`, no two-list model, and no "the browse effect must not re-fire
// while searching" reasoning. **One effect, not two.** The temptation is to
// generalise the two hooks into one with an optional search — resist it. The
// shared parts are already shared as modules (`activityInRange`, `widenedStart`,
// `startDayOf`, `dateRangeStore`, `ActivityRowList`), and what would be left is
// a hook whose shape is decided by a flag.
//
// It lives in `ui/` for the same reason its sibling does: nothing below `ui/`
// imports from `ui/` anywhere in this repo, and every import below is one
// StravaPage would otherwise make itself.
//
// **Its tests are StravaPage.test.jsx**, and there is no useStravaActivities
// .test.js beside it — unlike next door, where useIntervalsActivities has its
// own file because it was *extracted* from a page that already had a suite, and
// keeping that suite untouched is what proved the extraction behaviour-
// preserving. This hook was written with its page, has no such property to
// prove, and every one of its states is reachable through the page's props. A
// second suite here would test the same behaviour through a thinner surface.
//
// This is the only place that catches StravaApiError and switches on `.code`,
// which is the whole reason stravaApi.js throws a coded error rather than a
// plain one. Three recoveries, and they are genuinely different:
//   - `unauthorized` / `invalid_grant` — the grant is gone. Clear the tokens
//     and drop back to the connect view; there is no retry that helps.
//   - `athlete_cap` — the app is full. Also terminal, also drops back, but the
//     copy has to say what actually happened, because "connect again" is advice
//     that cannot work.
//   - everything else — a banner the athlete can retry past, tokens untouched.
//
// It is also where the raw wire shape stops. The read path maps through
// toActivityRow the moment it resolves, so the merge, the date predicate and
// the list below all deal in provider-neutral ActivityRows — `sport_type` and
// `start_date_local` appear nowhere past that line.
import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_RANGE_DAYS,
  activityInRange,
  defaultRange,
  isValidRange,
  startDayOf,
  widenedStart,
} from '../data/activityDateRange.js'
import { stravaDateRangeStore } from '../data/dateRangeStore.js'
import { activityListCache } from '../data/strava/activityListCache.js'
import {
  StravaApiError,
  deauthorize,
  listActivities,
  readFreshAccessToken,
} from '../data/strava/stravaApi.js'
import { stravaBoundsFor } from '../data/strava/stravaBoundsFor.js'
import { stravaStreamCache } from '../data/strava/streamCache.js'
import { stravaTokenStore } from '../data/strava/stravaTokenStore.js'
import { toActivityRow } from '../data/strava/toActivityRow.js'

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

/** The codes that mean "this connection is over" rather than "that request
 *  failed". Each drops back to the connect view carrying its own message —
 *  `athlete_cap` in particular must not read as a rejected login, because the
 *  athlete did nothing wrong and reconnecting cannot help. */
const TERMINAL_CODES = new Set(['unauthorized', 'invalid_grant', 'athlete_cap', 'not_connected'])

/** @typedef {import('../data/activityRow.js').ActivityRow} ActivityRow */

/**
 * Newest first, by the athlete's own wall clock. `startedAt` is
 * `YYYY-MM-DDTHH:MM:SS` with the offset already gone (toActivityRow strips
 * Strava's bogus trailing Z), so comparing the strings compares the instants —
 * the same property activityDateRange.js is built on.
 *
 * A row that never said when it happened sorts last rather than to the top: it
 * has no evidence for a position, and it must stay visible, which is
 * ActivityRowList's rule.
 */
function byNewestFirst(a, b) {
  if (!a.startedAt || !b.startedAt) return a.startedAt ? -1 : b.startedAt ? 1 : 0
  if (a.startedAt === b.startedAt) return 0
  return a.startedAt < b.startedAt ? 1 : -1
}

/**
 * Newest first, no duplicates. The dedup half is the intervals.icu hook's, for
 * the same reason — an overlapping window re-returns rows already held and the
 * incoming copy simply wins.
 *
 * **The sort is not.** Next door, `incoming` is always a superset of `held`, so
 * the response's own newest-first order is the merged order and no sort is
 * needed. Here `loadEarlier` lowers the request ceiling, so `incoming` is a
 * page of rows *older* than everything held — concatenating would put the
 * oldest page at the top of the list. The order is stated rather than inherited
 * from whatever the last response happened to contain.
 *
 * **It only ever accumulates.** A narrower response — which is what narrowing
 * the range produces — takes nothing away, deliberately: widening it again, or
 * pressing ↺, restores rows already fetched with no round trip. What the
 * athlete sees is `activities` put through `activityInRange`, never
 * `activities` itself.
 */
function mergeById(incoming, held) {
  const seen = new Set()
  const merged = []
  for (const activity of [...incoming, ...held]) {
    if (!activity?.id || seen.has(activity.id)) continue
    seen.add(activity.id)
    merged.push(activity)
  }
  return merged.sort(byNewestFirst)
}

/**
 * Everything StravaPage needs to render, and nothing about how it renders.
 *
 * Every collaborator is a parameter with a real default, matching
 * `useIntervalsActivities`'s seams and `credentialStore`'s documented pattern:
 * StravaPage passes none of them, and the suite drives the whole view through
 * fakes. The two caches are here rather than hidden inside the modules
 * precisely so `disconnect` can be *tested* clearing them.
 *
 * @param {{
 *   store?: typeof stravaTokenStore,
 *   listCache?: typeof activityListCache,
 *   streamCache?: typeof stravaStreamCache,
 *   rangeStore?: typeof stravaDateRangeStore,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export function useStravaActivities({
  store = stravaTokenStore,
  listCache = activityListCache,
  streamCache = stravaStreamCache,
  rangeStore = stravaDateRangeStore,
  fetchImpl,
} = {}) {
  // The *presence* of tokens is the state machine, exactly as the API key is
  // next door. Not the tokens themselves: they rotate under this component
  // (every six hours, and on every concurrent-refresh de-dup), and holding a
  // stale copy in React state is how a re-render sends a dead bearer token.
  // `readFreshAccessToken` reads the store at call time instead.
  const [isConnected, setIsConnected] = useState(() => store.read() !== null)
  // Seeded from the cache, so returning to the picker inside 15 minutes paints
  // the list immediately instead of blanking for a round trip. The request
  // still fires — see the effect. Read in the initialiser rather than an
  // effect for the same reason the range is: it must be there on first paint.
  const [activities, setActivities] = useState(
    /** @returns {ActivityRow[]} */ () => listCache.read() ?? [],
  )
  // The date filter, and the browse floor. Still the only thing the athlete
  // sees the list filtered *by* — but no longer the only edge of a request, and
  // `browseCeiling` below is the other one. Its own key, not intervals.icu's:
  // two accounts, two histories, and narrowing one says nothing about the
  // other.
  const [range, setRange] = useState(() => rangeStore.read() ?? defaultRange())
  // The upper edge of the *next request*; null means "the range's own end".
  //
  // The one piece of state the intervals.icu hook has no need of, and the
  // reason is its endpoint: that one returns the *whole* range, so widening the
  // floor genuinely returns more rows. Strava returns the newest `per_page`
  // **of** the range, so a wider window ending on the same day is the same 50
  // activities over again — the floor coming down does nothing unless the
  // ceiling comes down with it. See `loadEarlier`.
  //
  // It is a request bound only. Nothing is ever filtered out of the list by it;
  // `rows` below is `range` alone.
  const [browseCeiling, setBrowseCeiling] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const rows = activities.filter((a) => activityInRange(a, range))

  // The floor to use if the athlete empties the From field by hand — ↺ never
  // produces that state, but the field itself still can.
  const fallbackFrom = defaultRange().from

  // Primitives, not an object: the effect depends on them directly and stays
  // stable across renders with no memo. Epoch **seconds**, and `before` is
  // exclusive — stravaBoundsFor exists to get that conversion right in one
  // place, on top of the neutral string-based range.
  //
  // What goes in is the effective *request* window — the athlete's floor under
  // the browse ceiling — not the filter they see. The two differ only while
  // paging, and moving the ceiling re-fires the effect below on its own,
  // because `before` is already one of its deps.
  const { after, before } = stravaBoundsFor(
    { from: range.from, to: browseCeiling ?? range.to },
    fallbackFrom,
  )
  const isRangeUsable = isValidRange(range)

  /**
   * One terminal failure ends this connection. The tokens are cleared rather
   * than kept around to fail again on every later request, and both caches go
   * with them — nothing derived from the athlete's data may outlive the grant
   * (Policy §7.4). No `/oauth/deauthorize` call here, deliberately: a grant
   * Strava has already rejected is not one this app can revoke, and the request
   * would fail with the same credential that just failed.
   *
   * A useCallback because it sits in the effect's dep array; a fresh identity
   * each render would re-fire the request in a loop.
   */
  const endConnection = useCallback(
    (message) => {
      store.clear()
      listCache.clear()
      streamCache.clear()
      setIsConnected(false)
      setActivities([])
      setNotice(message)
    },
    [store, listCache, streamCache],
  )

  // Remembered for this tab only — see data/dateRangeStore.js for why session
  // and not local storage. Connect and disconnect need no explicit clear: both
  // set the range back to the default, which this then writes.
  useEffect(() => {
    rangeStore.save(range)
  }, [range, rangeStore])

  useEffect(() => {
    if (!isConnected) return undefined
    // A `to` before `from` matches nothing by definition, so there is no
    // request worth firing. Status drops to 'ready' rather than staying where
    // it was: nothing is in flight, and leaving it 'loading' would strand the
    // "Loading activities…" indicator until the athlete happened to fix the
    // range.
    if (!isRangeUsable) {
      setStatus('ready')
      return undefined
    }
    let cancelled = false
    setStatus('loading')
    setError(null)

    // The token is read — and refreshed if it is at or near expiry — inside the
    // effect rather than held in state. `readFreshAccessToken` de-duplicates
    // concurrent refreshes with an in-flight promise, which matters here
    // precisely because this effect can fire while an activity is loading:
    // refresh tokens rotate, so two live refreshes invalidate each other and
    // sign the athlete out at a moment that looks unrelated to anything they
    // did.
    readFreshAccessToken({ store, fetchImpl })
      .then((accessToken) => listActivities({ accessToken, after, before, fetchImpl }))
      // Mapped here, at the boundary, and never later: `mergeById` keys on
      // `row.id`, and everything downstream of it — the date predicate, the
      // widen anchor, the list — is written against ActivityRow alone.
      .then((raw) => {
        if (cancelled) return
        const incoming = raw.map(toActivityRow)
        setActivities((held) => {
          const merged = mergeById(incoming, held)
          // Written after the merge, not from the response, so what is cached
          // is what is on screen. Failing to persist is a shrug — the next
          // visit just starts blank.
          listCache.save(merged)
          return merged
        })
        setStatus('ready')
      })
      .catch((caught) => {
        if (cancelled) return
        if (caught instanceof StravaApiError && TERMINAL_CODES.has(caught.code)) {
          endConnection(caught.message)
          return
        }
        setError(caught instanceof StravaApiError ? caught.message : FALLBACK_ERROR)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
    // `after`/`before` are listed as the primitives they are. Bundling them
    // into one object would re-fire this on every render.
  }, [isConnected, after, before, isRangeUsable, store, listCache, fetchImpl, endConnection])

  /** Called by the OAuth callback once tokens are stored, and by StravaPage
   *  after a connect. Everything is reset so a second athlete on the same
   *  device never sees the first one's rows. */
  function connect() {
    listCache.clear()
    streamCache.clear()
    setNotice(null)
    setError(null)
    setActivities([])
    setRange(defaultRange())
    setBrowseCeiling(null)
    setIsConnected(true)
  }

  /**
   * **The order here is the API Policy §7.4 obligation, and it is the one thing
   * cache evaporation cannot satisfy.** Both caches first, then the network
   * call to revoke, then the tokens — because `deauthorize` needs a live access
   * token to send, so clearing the store first would make the revocation
   * impossible while looking like it succeeded.
   *
   * The revocation is deliberately **not** awaited before the UI drops back:
   * the athlete pressed Disconnect and the app must act disconnected
   * immediately. A failure is swallowed for the same reason — there is nothing
   * useful to say and nothing they can do, the local state is already gone, and
   * the grant remains revocable from strava.com/settings/apps, which the copy
   * links.
   *
   * @returns {Promise<void>} resolves once the revocation has been attempted,
   *   so the test can assert the call happened rather than racing it.
   */
  async function disconnect() {
    const tokens = store.read()

    listCache.clear()
    streamCache.clear()

    setIsConnected(false)
    setActivities([])
    setRange(defaultRange())
    setBrowseCeiling(null)
    setError(null)
    setNotice(null)

    try {
      if (tokens?.accessToken) {
        await deauthorize({ accessToken: tokens.accessToken, fetchImpl })
      }
    } catch {
      // See above. The grant stays revocable at strava.com/settings/apps.
    } finally {
      store.clear()
    }
  }

  /**
   * Paging moves **both** edges, and each half is load-bearing on its own.
   *
   * Lowering the ceiling is what actually pages: `/athlete/activities` answers
   * newest-first capped at `per_page`, so a window whose end never moves keeps
   * returning the same newest 50 however far back its start goes — which is
   * precisely the bug this replaced, where the button looked dead at ~50 rows.
   * Widening the floor is what makes the new rows *visible*: they still have to
   * pass `activityInRange` to reach the list.
   *
   * This is keyset paging, chosen over Strava's `page` param deliberately —
   * with offsets, changing the range resets to page 1 and the athlete re-walks
   * every page they already hold before reaching new ground.
   *
   * Anchored on `activities` rather than on `rows`: the anchor is the oldest
   * row actually fetched, not the oldest one currently visible.
   */
  function loadEarlier() {
    // The oldest day held, not the day before it: one day can hold several
    // activities and only some of them may have fitted in the last response.
    // Re-asking for that whole day costs one overlapping day, which mergeById
    // dedupes; skipping it would silently drop rows.
    const oldestHeldDay = activities.map(startDayOf).filter(Boolean).sort()[0]
    setRange((current) => ({
      ...current,
      from: widenedStart(current, activities, DEFAULT_RANGE_DAYS, fallbackFrom),
    }))
    // With nothing held — an empty or failed first window — there is no row to
    // anchor on, so the ceiling stays at the range's own end. The press is
    // still not a no-op: `widenedStart`'s final guard moves the floor anyway,
    // which changes `after` and re-fires the request.
    setBrowseCeiling(oldestHeldDay ?? range.to)
  }

  /**
   * The setter StravaPage hands to ActivityDateFilter. A new filter is a new
   * browse, not a continuation of the last one, so the ceiling drops back to
   * the range's own end — otherwise tapping *30 days* mid-paging would ask for
   * the last 30 days *ending months ago* and come back empty.
   *
   * Safe as a plain wrapper: ActivityDateFilter always calls it with a finished
   * range object, never with an updater function.
   */
  function changeRange(next) {
    setRange(next)
    setBrowseCeiling(null)
  }

  const isLoadingEarlier = status === 'loading' && activities.length > 0

  // Nothing truthful to render yet: an empty list would claim the window held
  // nothing while the answer is still in flight. Keyed on the **unfiltered**
  // list on purpose — it answers "has a response landed yet", not "is anything
  // visible". A range that filters every row out is an answer, and it has its
  // own empty message in the page. A cache hit means this is false on first
  // paint, which is the whole point of seeding from it.
  const isAwaitingFirstWindow = status === 'loading' && activities.length === 0

  return {
    isConnected,
    rows,
    status,
    error,
    notice,
    range,
    setRange: changeRange,
    isLoadingEarlier,
    isAwaitingFirstWindow,
    connect,
    disconnect,
    loadEarlier,
  }
}
