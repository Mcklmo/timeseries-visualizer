// The intervals.icu view, swapped into <main> the same way AboutPage is —
// no router in this app, so "navigation" is plain state (see App.jsx's `view`).
//
// Two halves: no key means the connect form, a key means the activity list.
// The key itself is the state machine — everything else follows from it.
//
// Every piece of read orchestration behind that — the two effects, the merge,
// the date range, the coded-error handling — lives in useIntervalsActivities,
// so what is left here is copy, layout and the wording that is genuinely
// intervals.icu's rather than any provider's.
import { formatRangeLabel, isRangeActive } from '../data/activityDateRange.js'
import { credentialStore } from '../data/intervals/credentialStore.js'
import { ActivityRowList } from './ActivityRowList.jsx'
import { IntervalsConnectForm } from './IntervalsConnectForm.jsx'
import { ActivityDateFilter } from './ActivityDateFilter.jsx'
import { useIntervalsActivities } from './useIntervalsActivities.js'

// intervals.icu's API Terms §1.1: information derived from Garmin-sourced
// data has to carry Garmin attribution. Shown only when this athlete actually
// has Garmin-synced activities in view, so it stays a true statement rather
// than boilerplate. The *question* is shared — Strava's API Policy §4.4 asks
// the same one, which is why the row answers it — but the sentence below is
// intervals.icu's own, so it stays here.
function hasGarminData(rows) {
  return rows.some((row) => row.isGarminDerived)
}

/**
 * `store` and `fetchImpl` are the picker's test seams and stay props of the
 * page rather than of the hook — App.jsx passes neither, and the suite drives
 * the whole view through them.
 *
 * @param {{
 *   onBack: () => void,
 *   onSelectActivity: (ref: import('../data/ActivitySource.js').IdActivityRef) => void,
 *   store?: typeof credentialStore,
 *   fetchImpl?: typeof fetch,
 * }} props
 */
export function IntervalsPage({ onBack, onSelectActivity, store = credentialStore, fetchImpl }) {
  const {
    apiKey,
    rows,
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
  } = useIntervalsActivities({ store, fetchImpl })

  // Names the range rather than claiming "the last few months" were empty.
  // With the filter on by default there is nearly always a range to name; the
  // fallback survives for a pair of fields the athlete emptied by hand.
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
        <IntervalsConnectForm onConnected={connect} fetchImpl={fetchImpl} notice={notice} />
      ) : (
        <>
          <div className="intervals-page__account">
            <button type="button" className="intervals-page__disconnect" onClick={disconnect}>
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

          <ActivityDateFilter range={range} onChange={setRange} />

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
            <ActivityRowList
              rows={rows}
              isLoadingEarlier={isLoadingEarlier}
              // Absent (not disabled) while searching: hits are scattered
              // through history, so there is no window under them to widen.
              // Browsing always offers it now — the range *is* the window, so
              // widening it is exactly what paging means.
              onLoadEarlier={isSearching ? undefined : loadEarlier}
              emptyMessage={emptyMessage}
              // `provider` is required on an id ref: sourceRegistry throws on
              // one without it rather than guessing, because guessing means
              // loading from the wrong athlete's account.
              //
              // `row.name` needs no `|| undefined` guard: the mapper already
              // drops an empty title, so a blank one can never override the
              // name deriveWorkoutName infers for the chart. `startedAtUtc` is
              // deliberately not passed on — this provider hands back the
              // athlete's original file, whose records carry their own
              // absolute timestamps.
              onSelect={(row) =>
                onSelectActivity({ type: 'id', provider: 'intervals', id: row.id, name: row.name })
              }
            />
          )}

          {/* Tracks what is actually on screen, so the credit stays a true
              statement in search mode too (API Terms §1.1). */}
          {hasGarminData(rows) && (
            <p className="intervals-page__attribution">Activity data from Garmin, via intervals.icu.</p>
          )}
        </>
      )}
    </div>
  )
}
