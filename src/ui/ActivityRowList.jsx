// The picker list, shared by every provider: the athlete's real activity
// history, newest first, one tap to load. It renders `ActivityRow`s
// (data/activityRow.js) and knows nothing about where they came from — that is
// exactly what lets a second provider reuse it instead of copying it.
//
// Every row is a real <button> — keyboard and screen-reader support for free,
// and a ≥44px tap height because this view exists precisely for the phone
// (ARCHITECTURE.md, "Mobile UX adaptation routes", Route E).
//
// A row that can't be loaded renders `disabled` with its reason as **visible
// dim text**, never a `title` tooltip, which is invisible on touch. It is
// never hidden either: an activity the athlete knows they recorded simply
// missing from the list reads as a bug in this app.
//
// What is left here is formatting only. *Why* a row can't be loaded, and what
// counts as a usable distance, are questions about a provider's payload and
// are answered in its mapper (data/intervals/toActivityRow.js).
import { formatDistanceKm, formatDuration } from '../domain/units.js'

// Pinned to en-GB rather than the visitor's locale so the row reads
// "Tue 12 Aug 2026" everywhere — day-before-month, matching the rest of the
// UI's European conventions, and stable enough to assert on.
//
// The year is always printed, never dropped for the current one: the date
// filter (activityDateRange.js) means any year can be on screen, and a list
// that omits the year on some rows and shows it on others is read as *this
// year* by default — exactly the wrong default for a range set to 2024.
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

// Deliberately a second parser, beside startDayOf in activityDateRange.js:
// this one needs the `Date` itself to hand to `Intl`, where that one reduces
// to a `YYYY-MM-DD` string. Routing this through it would only mean parsing
// twice.
function formatStartDate(startedAt) {
  if (!startedAt) return null
  // No trailing Z: `startedAt` is already the athlete's wall clock, so it must
  // be read as local time, not shifted into it.
  const date = new Date(startedAt)
  if (Number.isNaN(date.getTime())) return null
  return DATE_FORMAT.format(date).replace(',', '')
}

/**
 * `Tue 12 Aug 2026 · Run · 12.40 km · 58:12`, dropping whatever this activity
 * didn't tell us. Every field is optional by necessity, not by caution — the
 * mapper has already turned "unusable" into null, so a plain null check is the
 * whole test here.
 *
 * @param {import('../data/activityRow.js').ActivityRow} row
 */
export function describeActivity(row) {
  return [
    formatStartDate(row.startedAt),
    row.sportLabel,
    row.distanceM != null ? formatDistanceKm(row.distanceM) : null,
    row.durationS != null ? formatDuration(row.durationS) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Rows are identical whichever read path filled them — a browse window, a
 * search, or another provider entirely — because all of them arrive as
 * ActivityRows. Only the chrome flexes: `onLoadEarlier` is absent when the
 * list is a set of search hits rather than a window, since there is no window
 * to widen.
 *
 * @param {{
 *   rows: import('../data/activityRow.js').ActivityRow[],
 *   onSelect: (row: import('../data/activityRow.js').ActivityRow) => void,
 *   onLoadEarlier?: () => void,
 *   isLoadingEarlier?: boolean,
 *   emptyMessage?: string,
 * }} props
 */
export function ActivityRowList({
  rows,
  onSelect,
  onLoadEarlier,
  isLoadingEarlier,
  emptyMessage = 'No activities in the last few months.',
}) {
  if (rows.length === 0) {
    return <p className="activity-list__empty">{emptyMessage}</p>
  }

  return (
    <>
      <ul className="activity-list">
        {rows.map((row) => (
          <li key={row.id}>
            {/* `disabled` IS the guard against loading an unsupported row —
                there is no second check inside onSelect. */}
            <button
              type="button"
              className="activity-row"
              disabled={row.unsupportedReason !== null}
              onClick={() => onSelect(row)}
            >
              <span className="activity-row__name">{row.name || 'Untitled activity'}</span>
              <span className="activity-row__meta">{describeActivity(row)}</span>
              {row.unsupportedReason && (
                <span className="activity-row__reason">{row.unsupportedReason}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {/* A button, not infinite scroll: better on touch, and it needs no
          IntersectionObserver stub in jsdom. */}
      {onLoadEarlier && (
        <button
          type="button"
          className="activity-list__more"
          onClick={onLoadEarlier}
          disabled={isLoadingEarlier}
        >
          {isLoadingEarlier ? 'Loading…' : 'Load earlier activities'}
        </button>
      )}
    </>
  )
}
