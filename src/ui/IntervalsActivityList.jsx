// The connected half of IntervalsPage: the athlete's real activity history,
// newest first, one tap to load.
//
// Every row is a real <button> — keyboard and screen-reader support for free,
// and a ≥44px tap height because this view exists precisely for the phone
// (ARCHITECTURE.md, "Mobile UX adaptation routes", Route E).
//
// A row that can't be loaded renders `disabled` with its reason as **visible
// dim text**, never a `title` tooltip, which is invisible on touch. It is
// never hidden either: an activity the athlete knows they recorded simply
// missing from the list reads as a bug in this app.
import { formatDistanceKm, formatDuration } from '../domain/units.js'

/**
 * Why a row can't be loaded, or null if it can. Order matters: the specific
 * reasons are checked before the catch-all stub case, so a row that says
 * enough about itself gets the message that actually helps.
 *
 * `file_type` being absent is deliberately *not* a reason — the bytes are the
 * authority (detectActivityFormat.js) and this is only a pre-flight guard.
 */
export function unsupportedReason(activity) {
  if (activity.source === 'STRAVA') {
    return "Synced from Strava — intervals.icu doesn't keep the original file."
  }
  const fileType = activity.file_type?.toLowerCase()
  if (fileType && !['fit', 'tcx', 'gpx'].includes(fileType)) {
    return "This file type isn't supported."
  }
  // Strava-sourced activities come back as near-empty stubs where `id` may be
  // the only property present — so this catches the ones that didn't even say
  // they were from Strava.
  if (!activity.name && !activity.start_date_local) {
    return "This activity's details aren't available."
  }
  return null
}

// Pinned to en-GB rather than the visitor's locale so the row reads
// "Tue 12 Aug" everywhere — day-before-month, matching the rest of the UI's
// European conventions, and stable enough to assert on.
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function formatStartDate(startDateLocal) {
  if (!startDateLocal) return null
  // No trailing Z: start_date_local is already the athlete's wall clock, so
  // it must be read as local time, not shifted into it.
  const date = new Date(startDateLocal)
  if (Number.isNaN(date.getTime())) return null
  return DATE_FORMAT.format(date).replace(',', '')
}

/**
 * `Tue 12 Aug · Run · 12.40 km · 58:12`, dropping whatever this activity
 * didn't tell us. Every field is optional by necessity, not by caution.
 */
export function describeActivity(activity) {
  const distance = activity.icu_distance
  const movingTime = activity.moving_time ?? activity.elapsed_time
  return [
    formatStartDate(activity.start_date_local),
    activity.type,
    Number.isFinite(distance) && distance > 0 ? formatDistanceKm(distance) : null,
    Number.isFinite(movingTime) && movingTime > 0 ? formatDuration(movingTime) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * @param {{
 *   activities: object[],
 *   onSelect: (activity: object) => void,
 *   onLoadEarlier: () => void,
 *   isLoadingEarlier?: boolean,
 * }} props
 */
export function IntervalsActivityList({ activities, onSelect, onLoadEarlier, isLoadingEarlier }) {
  if (activities.length === 0) {
    return <p className="intervals-list__empty">No activities in the last few months.</p>
  }

  return (
    <>
      <ul className="intervals-list">
        {activities.map((activity) => {
          const reason = unsupportedReason(activity)
          return (
            <li key={activity.id}>
              <button
                type="button"
                className="intervals-activity"
                disabled={reason !== null}
                onClick={() => onSelect(activity)}
              >
                <span className="intervals-activity__name">{activity.name || 'Untitled activity'}</span>
                <span className="intervals-activity__meta">{describeActivity(activity)}</span>
                {reason && <span className="intervals-activity__reason">{reason}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {/* A button, not infinite scroll: better on touch, and it needs no
          IntersectionObserver stub in jsdom. */}
      <button
        type="button"
        className="intervals-list__more"
        onClick={onLoadEarlier}
        disabled={isLoadingEarlier}
      >
        {isLoadingEarlier ? 'Loading…' : 'Load earlier activities'}
      </button>
    </>
  )
}
