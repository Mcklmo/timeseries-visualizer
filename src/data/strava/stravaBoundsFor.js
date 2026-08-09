// The date range -> Strava's `after`/`before`. The Strava-side twin of
// `requestBoundsFor` in data/activityDateRange.js, and deliberately not a
// branch inside it: that module's whole design is that a range is two
// `YYYY-MM-DD` strings and every operation on it is a string operation, which
// is what makes it timezone-proof. Strava wants **epoch seconds**. The
// conversion belongs at this provider's boundary, on top of the neutral
// module, not inside it.
//
// **The inclusive-end trap is the same trap in a different unit.** `before` is
// exclusive, so an inclusive `to` has to be sent as midnight at the start of
// the *following* day — otherwise a range ending today returns nothing
// recorded today. That `+ 1 day` is `dayAfter`, exported from
// activityDateRange.js precisely so the calendar arithmetic happens in one
// place; this module must never do its own.
import { dayAfter } from '../activityDateRange.js'

/**
 * `YYYY-MM-DD` -> epoch **seconds** at **local** midnight that day.
 *
 * The numeric Date constructor, not `new Date('2026-03-01')`: a date-only
 * string is parsed as UTC per spec, which lands on the previous evening west
 * of Greenwich. activityDateRange.js's `parseDay` documents this at length and
 * is private there; this is the same rule, applied once, for the one case that
 * has to leave string space.
 *
 * Local rather than UTC because the athlete typed a day into a date field
 * while looking at their own calendar. Their 1 March is their 1 March.
 */
function epochSecondsAtLocalMidnight(day) {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return Math.floor(new Date(year, month - 1, dayOfMonth).getTime() / 1000)
}

/**
 * What to ask `/athlete/activities` for.
 *
 * `after` is nudged one second earlier than local midnight because Strava
 * treats it as strictly-after: without that, an activity started at exactly
 * 00:00:00 on the `from` day would be excluded from a range that names that
 * day. One second is invisible to everything else.
 *
 * `before` is omitted entirely when `to` is unset, restoring the endpoint's
 * own default of "up to now" — the same shape `requestBoundsFor` uses.
 *
 * @param {import('../activityDateRange.js').DateRange} range
 * @param {string} fallbackFrom `YYYY-MM-DD`, the default range's start, used
 *   when the athlete emptied the From field by hand
 * @returns {{after: number, before?: number}}
 */
export function stravaBoundsFor(range, fallbackFrom) {
  const from = range?.from ?? fallbackFrom
  const after = epochSecondsAtLocalMidnight(from) - 1
  return range?.to ? { after, before: epochSecondsAtLocalMidnight(dayAfter(range.to)) } : { after }
}
