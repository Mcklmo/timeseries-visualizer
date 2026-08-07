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
import { credentialStore } from '../data/intervals/credentialStore.js'
import { IntervalsApiError, listActivities, toApiDate } from '../data/intervals/intervalsApi.js'
import { IntervalsActivityList } from './IntervalsActivityList.jsx'
import { IntervalsConnectForm } from './IntervalsConnectForm.jsx'

// Wide enough that a first load almost always fills the screen, narrow enough
// that it stays one quick request on a phone connection.
const WINDOW_DAYS = 90

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

function daysBefore(date, days) {
  const shifted = new Date(date)
  shifted.setDate(shifted.getDate() - days)
  return shifted
}

function startDateOf(activity) {
  if (!activity?.start_date_local) return null
  const date = new Date(activity.start_date_local)
  return Number.isNaN(date.getTime()) ? null : date
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
 */
function nextWindowStart(activities, currentStart) {
  const oldestHeld = activities.map(startDateOf).filter(Boolean).sort((a, b) => a - b)[0]
  const candidate = daysBefore(oldestHeld ?? currentStart, WINDOW_DAYS)
  return candidate < currentStart ? candidate : daysBefore(currentStart, WINDOW_DAYS)
}

/**
 * Newest first, no duplicates. `newest` is never sent (it would drop today's
 * activities — see intervalsApi.js), so each widened window re-returns
 * everything already held and the incoming copy simply wins.
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
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  // One 401 is terminal for that key — there is no retry loop here. The key
  // is cleared rather than kept around to fail again on every later request.
  const rejectKey = useCallback(
    (message) => {
      store.clearApiKey()
      setApiKey(null)
      setActivities([])
      setNotice(message)
    },
    [store],
  )

  useEffect(() => {
    if (!apiKey) return undefined
    let cancelled = false
    setStatus('loading')
    setError(null)

    listActivities({ apiKey, oldest: toApiDate(windowStart), fetchImpl })
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
  }, [apiKey, windowStart, fetchImpl, rejectKey])

  function handleConnected(key) {
    // Validated by the form before it got here, so this only ever stores a
    // key already proven to work. A browser that refuses to persist it (see
    // credentialStore.js) still leaves the session usable — it just won't
    // survive a reload.
    store.saveApiKey(key)
    setNotice(null)
    setActivities([])
    setWindowStart(daysBefore(new Date(), WINDOW_DAYS))
    setApiKey(key)
  }

  function handleDisconnect() {
    store.clearApiKey()
    setApiKey(null)
    setActivities([])
    setError(null)
    setNotice(null)
  }

  const isLoadingEarlier = status === 'loading' && activities.length > 0

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

          {status === 'loading' && activities.length === 0 ? (
            <p className="loading-indicator" role="status">
              Loading activities…
            </p>
          ) : (
            <IntervalsActivityList
              activities={activities}
              isLoadingEarlier={isLoadingEarlier}
              onLoadEarlier={() => setWindowStart((current) => nextWindowStart(activities, current))}
              onSelect={(activity) =>
                onSelectActivity({ type: 'id', id: activity.id, name: activity.name || undefined })
              }
            />
          )}

          {hasGarminData(activities) && (
            <p className="intervals-page__attribution">Activity data from Garmin, via intervals.icu.</p>
          )}
        </>
      )}
    </div>
  )
}
