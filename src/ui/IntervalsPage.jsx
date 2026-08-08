// The intervals.icu view, swapped into <main> the same way AboutPage is —
// no router in this app, so "navigation" is plain state (see App.jsx's `view`).
//
// Two halves: no key means the connect form, a key means the activity list.
// The key itself is the state machine — everything else follows from it.
//
// This is the only place that catches IntervalsApiError and switches on
// `.code`, which is the whole reason intervalsApi.js throws a coded error
// rather than a plain one (see its header). A rejected key has to be told
// apart from a failed network: the first clears the stored credential and
// drops back to the connect form, the second leaves everything alone and
// shows a banner the user can retry past.
import { useCallback, useEffect, useState } from 'react'
import {
  EMPTY_RANGE,
  activityInRange,
  formatRangeLabel,
  isRangeActive,
  isValidRange,
  requestBoundsFor,
  startDayOf,
} from '../data/intervals/activityDateRange.js'
import { credentialStore } from '../data/intervals/credentialStore.js'
import {
  IntervalsApiError,
  listActivities,
  searchActivities,
  toApiDate,
} from '../data/intervals/intervalsApi.js'
import { IntervalsActivityList } from './IntervalsActivityList.jsx'
import { IntervalsConnectForm } from './IntervalsConnectForm.jsx'
import { IntervalsDateFilter } from './IntervalsDateFilter.jsx'
import { useDebouncedValue } from './useDebouncedValue.js'

// Wide enough that a first load almost always fills the screen, narrow enough
// that it stays one quick request on a phone connection.
const WINDOW_DAYS = 90

// Long enough that a normal typing burst is one request, short enough that the
// list still feels like it is following the keyboard.
const SEARCH_DEBOUNCE_MS = 300

// One character matches most of a history and costs a full-fat response for
// nothing (see searchActivities), so the box stays inert until there are two.
const MIN_QUERY_LENGTH = 2

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

function daysBefore(date, days) {
  const shifted = new Date(date)
  shifted.setDate(shifted.getDate() - days)
  return shifted
}

/**
 * The next `oldest` to request. Anchored on the oldest activity actually
 * held, not on the previous window's own `oldest` — those differ whenever a
 * response came back capped, and the previous `oldest` would then claim to
 * have covered ground that was never returned.
 *
 * The final guard keeps the button honest: it must always widen the window,
 * even when an empty or capped response left the anchor newer than where the
 * current window already starts.
 *
 * Anchors on calendar days rather than instants (`startDayOf` returns
 * `YYYY-MM-DD`, which a plain `.sort()` orders chronologically) — day
 * granularity is more than enough for a step measured in months, and it means
 * this file no longer carries its own copy of the `start_date_local` parser.
 */
function nextWindowStart(activities, currentStart) {
  const oldestHeldDay = activities.map(startDayOf).filter(Boolean).sort()[0]
  // The `T00:00:00` is load-bearing: a bare `YYYY-MM-DD` is parsed as UTC,
  // which lands on the previous evening west of Greenwich; with a time part
  // and no offset, the spec says local — the same reading start_date_local
  // itself gets everywhere else in this feature.
  const anchor = oldestHeldDay ? new Date(`${oldestHeldDay}T00:00:00`) : currentStart
  const candidate = daysBefore(anchor, WINDOW_DAYS)
  return candidate < currentStart ? candidate : daysBefore(currentStart, WINDOW_DAYS)
}

/**
 * Newest first, no duplicates. While browsing, each widened window re-returns
 * everything already held and the incoming copy simply wins.
 *
 * **It only ever accumulates.** A narrower response — which is what a date
 * range produces — takes nothing away, deliberately: clearing the range then
 * restores rows already fetched with no round trip. What the athlete sees is
 * `activities` put through `activityInRange`, never `activities` itself.
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

// intervals.icu's API Terms §1.1: information derived from Garmin-sourced
// data has to carry Garmin attribution. Shown only when this athlete actually
// has Garmin-synced activities in view, so it stays a true statement rather
// than boilerplate.
function hasGarminData(activities) {
  return activities.some((a) => a.source === 'GARMIN_CONNECT' || a.device_name)
}

/**
 * @param {{
 *   onBack: () => void,
 *   onSelectActivity: (ref: {type: 'id', id: string, name?: string}) => void,
 *   store?: typeof credentialStore,
 *   fetchImpl?: typeof fetch,
 * }} props
 */
export function IntervalsPage({ onBack, onSelectActivity, store = credentialStore, fetchImpl }) {
  const [apiKey, setApiKey] = useState(() => store.readApiKey())
  const [activities, setActivities] = useState([])
  const [windowStart, setWindowStart] = useState(() => daysBefore(new Date(), WINDOW_DAYS))
  // The date filter. Kept alongside `windowStart` rather than replacing it:
  // with no `from` the rolling window is still the floor, so browsing and
  // paging behave exactly as they did before anyone touches the fields.
  const [range, setRange] = useState(EMPTY_RANGE)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [query, setQuery] = useState('')
  // Kept entirely apart from `activities` — see the search effect below for
  // why merging the two would break paging.
  const [results, setResults] = useState(/** @type {object[] | null} */ (null))
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
  const shown = (isSearching ? (results ?? []) : activities).filter((a) => activityInRange(a, range))

  // Primitives, not an object: the browse effect can then depend on them
  // directly and stay stable across renders with no memo.
  const { oldest, newest } = requestBoundsFor(range, toApiDate(windowStart))
  const isRangeUsable = isValidRange(range)

  // One 401 is terminal for that key — there is no retry loop here. The key
  // is cleared rather than kept around to fail again on every later request.
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
      .then((rows) => {
        if (cancelled) return
        setActivities((held) => mergeById(rows, held))
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
  }, [apiKey, oldest, newest, isRangeUsable, fetchImpl, rejectKey])

  // The second read path. It searches the athlete's whole history, so it is
  // *not* a widening of the window above and its hits must never be merged
  // into `activities`: mergeById and nextWindowStart both assume that list is
  // a contiguous newest-first window anchored on real dates, and folding in
  // arbitrary matches from years back would send "Load earlier" off to the
  // wrong anchor. Two lists, one rendered at a time.
  //
  // The browse effect keys on the request bounds alone, so it does not re-fire
  // while searching — which is why the browse list is simply still there the
  // moment the box is cleared, with no refetch. Clearing the *range* does
  // re-fire it (the bounds genuinely changed back), but nothing flashes:
  // `activities` still holds every row it ever merged, so they re-appear
  // through the predicate on the same render the range cleared on, while the
  // widened request settles behind them.
  //
  // `cancelled` is this file's existing stale-response guard, and debounced
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
      .then((rows) => {
        if (cancelled) return
        setResults(rows)
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

  function handleConnected(key) {
    // Validated by the form before it got here, so this only ever stores a
    // key already proven to work. A browser that refuses to persist it (see
    // credentialStore.js) still leaves the session usable — it just won't
    // survive a reload.
    store.saveApiKey(key)
    setNotice(null)
    setActivities([])
    setQuery('')
    setRange(EMPTY_RANGE)
    setWindowStart(daysBefore(new Date(), WINDOW_DAYS))
    setApiKey(key)
  }

  function handleDisconnect() {
    store.clearApiKey()
    setApiKey(null)
    setActivities([])
    setQuery('')
    setRange(EMPTY_RANGE)
    setError(null)
    setNotice(null)
  }

  const isLoadingEarlier = status === 'loading' && activities.length > 0

  // Nothing truthful to render yet in either mode: an empty list would claim
  // the window held nothing, or that the query matched nothing, while the
  // answer is still in flight. The indicator stands in for the list.
  //
  // Both stay keyed on the **unfiltered** lists on purpose: they answer "has a
  // response landed yet", not "is anything visible". A range that filters
  // every row out is an answer, and it has its own empty message below.
  const isAwaitingFirstWindow = !isSearching && status === 'loading' && activities.length === 0
  const isAwaitingFirstHits = isSearching && searchStatus === 'loading' && results === null

  // Names the range rather than the default "last few months", which would be
  // a plain lie once the athlete has asked for March.
  const rangeLabel = isRangeActive(range) ? formatRangeLabel(range) : null
  const emptyMessage = isSearching
    ? `No activities match "${activeQuery}"${rangeLabel ? ` ${rangeLabel}` : ''}.`
    : rangeLabel
      ? `No activities ${rangeLabel}.`
      : undefined

  return (
    <div className="intervals-page">
      <button type="button" className="about-page__back" onClick={onBack}>
        ← Back
      </button>
      <h2>intervals.icu</h2>

      {!apiKey ? (
        <IntervalsConnectForm onConnected={handleConnected} fetchImpl={fetchImpl} notice={notice} />
      ) : (
        <>
          <div className="intervals-page__account">
            <button type="button" className="intervals-page__disconnect" onClick={handleDisconnect}>
              Disconnect
            </button>
            <p className="intervals-page__hint">
              Removes the key from this browser. It stays valid on intervals.icu — regenerate it in
              Developer Settings there if you want it revoked.
            </p>
          </div>

          {error && (
            <p className="intervals-page__error" role="alert">
              {error}
            </p>
          )}

          {/* A form so Enter is handled rather than reloading the page, and
              type="search" so the platform offers its own clear affordance on
              the devices that have one. The ✕ is for the ones that don't. */}
          <form className="intervals-search" role="search" onSubmit={(e) => e.preventDefault()}>
            <input
              type="search"
              className="intervals-search__input"
              aria-label="Search activities"
              placeholder="Search all activities, or #tag"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="intervals-search__clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                ✕
              </button>
            )}
          </form>

          <IntervalsDateFilter range={range} onChange={setRange} />

          {isAwaitingFirstWindow && (
            <p className="loading-indicator" role="status">
              Loading activities…
            </p>
          )}

          {searchStatus === 'loading' && (
            <p className="loading-indicator" role="status">
              Searching…
            </p>
          )}

          {!isAwaitingFirstWindow && !isAwaitingFirstHits && (
            <IntervalsActivityList
              activities={shown}
              isLoadingEarlier={isLoadingEarlier}
              // Omitted while searching: hits are scattered through history,
              // so there is no window under them to widen. Omitted with a
              // `from` set for the opposite reason — the athlete has stated
              // the floor, so there is nothing left to widen towards. With
              // only `to` set the window is still the floor and paging works
              // exactly as before.
              onLoadEarlier={
                isSearching || range.from
                  ? undefined
                  : () => setWindowStart((current) => nextWindowStart(activities, current))
              }
              emptyMessage={emptyMessage}
              onSelect={(activity) =>
                onSelectActivity({ type: 'id', id: activity.id, name: activity.name || undefined })
              }
            />
          )}

          {/* Tracks what is actually on screen, so the credit stays a true
              statement in search mode too (API Terms §1.1). */}
          {hasGarminData(shown) && (
            <p className="intervals-page__attribution">Activity data from Garmin, via intervals.icu.</p>
          )}
        </>
      )}
    </div>
  )
}
