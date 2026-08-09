// The intervals.icu picker's whole read side — the stored key, the browse
// window, the search, and the date range that drives both — lifted out of
// IntervalsPage so the page is left with copy and JSX.
//
// Strava is why this exists now. Its picker needs the same eight pieces of
// state, the same two effects and the same merge against a different API; a
// sibling hook can have them, 385 lines of page cannot.
//
// It lives in `ui/` rather than `data/intervals/` for one concrete reason: it
// needs useDebouncedValue, which is in `ui/`, and *nothing below `ui/` imports
// from `ui/` anywhere in this repo*. Every import below is one IntervalsPage
// already made, so this extraction adds no cross-layer edge at all. The
// precedent is exact — useDebouncedValue was itself pulled out of this same
// page into `ui/` purely so it could be tested without rendering a page that
// also fetches.
//
// This is the only place that catches IntervalsApiError and switches on
// `.code`, which is the whole reason intervalsApi.js throws a coded error
// rather than a plain one (see its header). A rejected key has to be told
// apart from a failed network: the first clears the stored credential and
// drops back to the connect form, the second leaves everything alone and
// shows a banner the user can retry past.
//
// It is also where the raw wire shape stops. Both read paths map through
// toActivityRow the moment they resolve, so the merge, the date predicate and
// the list below all deal in provider-neutral ActivityRows — the field names
// `icu_distance` and `start_date_local` appear nowhere past that line.
import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_RANGE_DAYS,
  activityInRange,
  defaultRange,
  isValidRange,
  requestBoundsFor,
  widenedStart,
} from '../data/activityDateRange.js'
import { credentialStore } from '../data/intervals/credentialStore.js'
import { dateRangeStore } from '../data/dateRangeStore.js'
import { IntervalsApiError, listActivities, searchActivities } from '../data/intervals/intervalsApi.js'
import { toActivityRow } from '../data/intervals/toActivityRow.js'
import { useDebouncedValue } from './useDebouncedValue.js'

// Long enough that a normal typing burst is one request, short enough that the
// list still feels like it is following the keyboard.
const SEARCH_DEBOUNCE_MS = 300

// One character matches most of a history and costs a full-fat response for
// nothing (see searchActivities), so the box stays inert until there are two.
const MIN_QUERY_LENGTH = 2

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

/** @typedef {import('../data/activityRow.js').ActivityRow} ActivityRow */

/**
 * Newest first, no duplicates. While browsing, each widened window re-returns
 * everything already held and the incoming copy simply wins.
 *
 * **It only ever accumulates.** A narrower response — which is what narrowing
 * the range produces — takes nothing away, deliberately: widening it again, or
 * pressing ↺, then restores rows already fetched with no round trip. What the
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
  return merged
}

// KNOWN ROUGH EDGES — pre-existing, carried across deliberately. The
// extraction was behaviour-preserving, which is what makes IntervalsPage's
// untouched test suite proof that it worked, so none of these were fixed on
// the way. Each is its own change, with its own test:
//
// - `connect` never calls `setError(null)`. It self-heals only because the
//   browse effect reaches `setError(null)` — which only happens because
//   `defaultRange()` is always valid, so the `isRangeUsable` early return
//   isn't taken. A hidden ordering dependency between two functions that
//   otherwise look independent.
// - `rejectKey` leaves `error`, `results` and `searchStatus` untouched, so a
//   rejection mid-search strands hits in memory behind the connect form.
// - "Searching…" renders on top of stale results, where its browse-side twin
//   is gated on `isAwaitingFirstWindow`.

/**
 * Everything IntervalsPage needs to render, and nothing about how it renders.
 *
 * `store` and `fetchImpl` stay parameters rather than hard-wired imports
 * because they are the picker's test seams, and they are threaded down from
 * IntervalsPage's own props — the page suite drives all of this through a fake
 * store and a URL-routing fetch stub, and would have to be rewritten if the
 * seams moved here.
 *
 * A named object, not a tuple: seventeen positional slots would be unreadable,
 * and this repo returns bare values or named objects from hooks, never tuples.
 *
 * @param {{store?: typeof credentialStore, fetchImpl?: typeof fetch}} [options]
 */
export function useIntervalsActivities({ store = credentialStore, fetchImpl } = {}) {
  const [apiKey, setApiKey] = useState(() => store.readApiKey())
  const [activities, setActivities] = useState(/** @type {ActivityRow[]} */ ([]))
  // The date filter, and the *only* browse floor — there is no separate
  // rolling window beside it any more, so paging and filtering are one
  // mechanism in one representation.
  //
  // Read in the initialiser rather than an effect so the very first request
  // already uses the remembered range, the same reason ChartViewContext seeds
  // itself from viewPrefsStore during render instead of after mount.
  const [range, setRange] = useState(() => dateRangeStore.read() ?? defaultRange())
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [query, setQuery] = useState('')
  // Kept entirely apart from `activities` — see the search effect below for
  // why merging the two would break paging.
  const [results, setResults] = useState(/** @type {ActivityRow[] | null} */ (null))
  const [searchStatus, setSearchStatus] = useState('idle')

  // The debounce delays *starting* a search, never stopping one: emptying the
  // box drops back to the browse list on the keystroke rather than leaving
  // the previous query's hits on screen for another 300 ms.
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const activeQuery = query.trim().length >= MIN_QUERY_LENGTH ? debouncedQuery : ''
  const isSearching = activeQuery.length >= MIN_QUERY_LENGTH

  // The range drives the request *and* a client-side predicate, which is not
  // redundancy. The request so the right months get fetched without paging
  // back through years; the predicate because `mergeById` accumulates rows
  // across every widened window, and those held rows must stop rendering the
  // moment the range narrows — a narrower request never removes anything on
  // its own. The same predicate then filters search hits for free, which is
  // the only way to filter them at all: neither search endpoint accepts
  // `oldest`/`newest` (see searchActivities).
  //
  // Known cost of that endpoint, not a bug: `/search-full` returns the ~30
  // most relevant hits across all history, so an active range filters those
  // 30 and can legitimately empty the list while older matches exist further
  // down a ranking the API never sent us.
  const rows = (isSearching ? (results ?? []) : activities).filter((a) => activityInRange(a, range))

  // The floor to use if the athlete empties the From field by hand — ↺ never
  // produces that state, but the field itself still can. Recomputed per render
  // rather than memoised: two string operations, and it only changes when the
  // calendar day does, which is exactly when the browse effect *should* see a
  // new `oldest`.
  const fallbackOldest = defaultRange().from

  // Primitives, not an object: the browse effect can then depend on them
  // directly and stay stable across renders with no memo.
  const { oldest, newest } = requestBoundsFor(range, fallbackOldest)
  const isRangeUsable = isValidRange(range)

  // One 401 is terminal for that key — there is no retry loop here. The key
  // is cleared rather than kept around to fail again on every later request.
  //
  // A useCallback because it sits in *both* effects' dep arrays; a fresh
  // identity each render would re-fire the browse request on every keystroke.
  const rejectKey = useCallback(
    (message) => {
      store.clearApiKey()
      setApiKey(null)
      setActivities([])
      setQuery('')
      setNotice(message)
    },
    [store],
  )

  // Remembered for this tab only — see dateRangeStore.js for why session and
  // not local storage. Connect and disconnect need no explicit clear: both set
  // the range back to the default, which this then writes.
  useEffect(() => {
    dateRangeStore.save(range)
  }, [range])

  useEffect(() => {
    if (!apiKey) return undefined
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

    listActivities({ apiKey, oldest, newest, fetchImpl })
      // Mapped here, at the boundary, and never later: `mergeById` below keys
      // on `row.id`, and everything downstream of it — the date predicate, the
      // widen anchor, the list — is written against ActivityRow alone.
      .then((raw) => {
        if (cancelled) return
        const incoming = raw.map(toActivityRow)
        setActivities((held) => mergeById(incoming, held))
        setStatus('ready')
      })
      .catch((caught) => {
        if (cancelled) return
        if (caught instanceof IntervalsApiError && caught.code === 'unauthorized') {
          rejectKey(caught.message)
          return
        }
        setError(caught instanceof IntervalsApiError ? caught.message : FALLBACK_ERROR)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
    // `oldest`/`newest` are listed as the primitives they are. Bundling them
    // into one object would re-fire this on every render.
  }, [apiKey, oldest, newest, isRangeUsable, fetchImpl, rejectKey])

  // The second read path. It searches the athlete's whole history, so it is
  // *not* a widening of the window above and its hits must never be merged
  // into `activities`: mergeById and widenedStart both assume that list is a
  // contiguous newest-first window anchored on real dates, and folding in
  // arbitrary matches from years back would send "Load earlier" off to the
  // wrong anchor. Two lists, one rendered at a time.
  //
  // The browse effect keys on the request bounds alone, so it does not re-fire
  // while searching — which is why the browse list is simply still there the
  // moment the box is cleared, with no refetch. Widening the *range* does
  // re-fire it (the bounds genuinely changed), but nothing flashes:
  // `activities` still holds every row it ever merged, so they re-appear
  // through the predicate on the same render the range changed on, while the
  // widened request settles behind them.
  //
  // `cancelled` is this hook's existing stale-response guard, and debounced
  // typing is exactly what it was written for: each new query's run cancels
  // the previous one, so a slow early response cannot land on top of a newer
  // query's rows.
  useEffect(() => {
    if (!apiKey || !activeQuery) {
      // Dropping the last query's hits here is what makes clearing the box a
      // clean return to browsing, with nothing stale left to flash on the
      // next search.
      setResults(null)
      setSearchStatus('idle')
      return undefined
    }
    let cancelled = false
    setSearchStatus('loading')
    setError(null)

    searchActivities({ apiKey, query: activeQuery, fetchImpl })
      // The same mapping as the browse path, for the same reason: the two
      // lists are rendered by one component and filtered by one predicate, so
      // they have to be the same shape.
      .then((raw) => {
        if (cancelled) return
        setResults(raw.map(toActivityRow))
        setSearchStatus('ready')
      })
      .catch((caught) => {
        if (cancelled) return
        if (caught instanceof IntervalsApiError && caught.code === 'unauthorized') {
          rejectKey(caught.message)
          return
        }
        setError(caught instanceof IntervalsApiError ? caught.message : FALLBACK_ERROR)
        setSearchStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [apiKey, activeQuery, fetchImpl, rejectKey])

  function connect(key) {
    // Validated by the form before it got here, so this only ever stores a
    // key already proven to work. A browser that refuses to persist it (see
    // credentialStore.js) still leaves the session usable — it just won't
    // survive a reload.
    store.saveApiKey(key)
    setNotice(null)
    setActivities([])
    setQuery('')
    setRange(defaultRange())
    setApiKey(key)
  }

  function disconnect() {
    store.clearApiKey()
    setApiKey(null)
    setActivities([])
    setQuery('')
    setRange(defaultRange())
    setError(null)
    setNotice(null)
  }

  // Paging *is* widening the range now, since the range is the only browse
  // floor there is. Anchored on `activities` rather than on `rows`: the anchor
  // is the oldest row actually fetched, not the oldest one currently visible.
  function loadEarlier() {
    setRange((current) => ({
      ...current,
      from: widenedStart(current, activities, DEFAULT_RANGE_DAYS, fallbackOldest),
    }))
  }

  const isLoadingEarlier = status === 'loading' && activities.length > 0

  // Nothing truthful to render yet in either mode: an empty list would claim
  // the window held nothing, or that the query matched nothing, while the
  // answer is still in flight. The indicator stands in for the list.
  //
  // Both stay keyed on the **unfiltered** lists on purpose: they answer "has a
  // response landed yet", not "is anything visible". A range that filters
  // every row out is an answer, and it has its own empty message in the page.
  const isAwaitingFirstWindow = !isSearching && status === 'loading' && activities.length === 0
  const isAwaitingFirstHits = isSearching && searchStatus === 'loading' && results === null

  return {
    apiKey,
    rows,
    status,
    error,
    notice,
    query,
    setQuery,
    range,
    setRange,
    isSearching,
    activeQuery,
    searchStatus,
    isLoadingEarlier,
    isAwaitingFirstWindow,
    isAwaitingFirstHits,
    connect,
    disconnect,
    loadEarlier,
  }
}
