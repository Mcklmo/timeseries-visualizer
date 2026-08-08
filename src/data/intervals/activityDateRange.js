// The date-range filter's whole model, in one pure module: no React, no DOM,
// nothing imported but `toApiDate`. IntervalsPage owns the state and
// IntervalsDateFilter renders it; both read their rules from here.
//
// **A range is two `YYYY-MM-DD` strings, never two Dates.** That is exactly
// what `<input type="date">`.value reads and writes regardless of display
// locale, it is already the API's wire format, and — the part that matters —
// lexicographic comparison of `YYYY-MM-DD` *is* chronological comparison. So
// the predicate, the `from <= to` check and the request bounds are all plain
// string operations, sidestepping every timezone trap the rest of this folder
// carries warnings about. Dates appear only where a calendar has to be walked
// (`dayAfter`) or formatted (`formatRangeLabel`), and both go through
// `parseDay` for the reason documented there.
import { toApiDate } from './intervalsApi.js'

/** No filter. The page's initial state, and where the ✕ returns to. */
export const EMPTY_RANGE = { from: null, to: null }

/** @typedef {{from: string | null, to: string | null}} DateRange */

/** Either bound set — one open end is still a filter. */
export function isRangeActive(range) {
  return Boolean(range?.from || range?.to)
}

/**
 * `min`/`max` stop the native calendar offering an inverted range, but typing
 * into the field bypasses them, so this is the check everything else keys on:
 * the inputs mark themselves invalid and the page skips a request it already
 * knows returns nothing. One open end can never be inverted.
 */
export function isValidRange(range) {
  if (!range?.from || !range?.to) return true
  return range.from <= range.to
}

/**
 * `YYYY-MM-DD` → a Date at **local** midnight. `new Date('2026-03-01')` is the
 * obvious spelling and is wrong: a date-only string is parsed as UTC per the
 * spec, so west of Greenwich it lands on the previous evening — and `+1 day`
 * then gives back the day you started with. The numeric constructor is local
 * by definition, and it normalises overflow (`new Date(2026, 11, 32)` is
 * 2027-01-01), which is what makes `dayAfter` correct across month and year
 * boundaries without any calendar arithmetic of its own.
 * @param {string} day
 */
function parseDay(day) {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return new Date(year, month - 1, dayOfMonth)
}

/**
 * The calendar day an activity happened on, or null when it didn't say.
 *
 * This is the **single** parser for `start_date_local` on the filtering path —
 * IntervalsPage's `nextWindowStart` reads it too. `IntervalsActivityList`'s
 * `formatStartDate` keeps its own, deliberately: it needs the `Date` itself to
 * hand to `Intl`, so routing it through here would only mean parsing twice.
 * Do not add a fourth copy.
 *
 * No trailing Z is added: `start_date_local` is already the athlete's wall
 * clock, and appending one shifts it into their own offset a second time.
 */
export function startDayOf(activity) {
  const startDateLocal = activity?.start_date_local
  if (!startDateLocal) return null
  const date = new Date(startDateLocal)
  return Number.isNaN(date.getTime()) ? null : toApiDate(date)
}

/**
 * Inclusive at both ends — "1 Mar to 31 Mar" means the whole of both days,
 * which is what the two fields read as. Comparing calendar days rather than
 * instants is what makes a 23:50 activity on the `to` day pass.
 *
 * An activity with no usable date **passes when no range is set and fails when
 * one is**. Both halves are deliberate: a Strava stub cannot honestly be
 * claimed to fall in March, but it must stay visible (disabled, with its
 * reason) in the default view — IntervalsActivityList's rule is that an
 * activity the athlete knows they recorded is never silently hidden.
 */
export function activityInRange(activity, range) {
  if (!isRangeActive(range)) return true
  const day = startDayOf(activity)
  if (!day) return false
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

/**
 * The day after `day`, as `YYYY-MM-DD`. Exported for the tests that pin the
 * month- and year-boundary cases; callers want `requestBoundsFor`.
 * @param {string} day
 */
export function dayAfter(day) {
  const date = parseDay(day)
  date.setDate(date.getDate() + 1)
  return toApiDate(date)
}

/**
 * What to ask `/activities` for, given the range and the page's rolling-window
 * floor to fall back on when the athlete named no start.
 *
 * **The `+ 1 day` on `newest` is the entire point of this function.** The API
 * reads `newest=<day>` as midnight *at the start* of that day (see
 * intervalsApi.js), so an inclusive end date has to be sent as the day after —
 * otherwise a range ending today returns nothing recorded today, which is the
 * single easiest thing to get wrong here. `newest` is omitted entirely when
 * `to` is unset, restoring the endpoint's own default of "up to now".
 *
 * @param {DateRange} range
 * @param {string} fallbackOldest - `YYYY-MM-DD`, the browse window's start
 * @returns {{oldest: string, newest?: string}}
 */
export function requestBoundsFor(range, fallbackOldest) {
  const oldest = range?.from ?? fallbackOldest
  return range?.to ? { oldest, newest: dayAfter(range.to) } : { oldest }
}

/**
 * Whole days back from `today`, ending today. Local-midnight arithmetic via
 * `setDate`, which rolls months and years over for us.
 */
function lastDays(today, days) {
  const from = new Date(today)
  from.setDate(from.getDate() - days)
  return { from: toApiDate(from), to: toApiDate(today) }
}

/**
 * The one-tap ranges. Counted in **days, not calendar months**: `setMonth` on
 * the 31st silently overflows (31 May − 3 months is 3 March, not 28 February),
 * and nobody reading "3 months" here is asking for a precise calendar span —
 * they are asking for roughly the last season of training. 90 and 365 are also
 * exactly what the labels imply to an athlete, and 90 matches the browse
 * window IntervalsPage already uses.
 *
 * @type {{id: string, label: string, rangeFor: (today: Date) => DateRange}[]}
 */
export const PRESETS = [
  { id: '30d', label: '30 days', rangeFor: (today) => lastDays(today, 30) },
  { id: '3m', label: '3 months', rangeFor: (today) => lastDays(today, 90) },
  { id: '12m', label: '12 months', rangeFor: (today) => lastDays(today, 365) },
]

// Pinned to en-GB rather than the visitor's locale, matching DATE_FORMAT in
// IntervalsActivityList.jsx — the empty message names the same days the rows
// do, and in the same order, so "1 Mar" can't mean January the 3rd here and
// March the 1st two lines down.
const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const DAY_FORMAT_NO_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/**
 * The range as a sentence fragment for the empty state — `between 1 Mar and
 * 31 Mar 2026`, or one open end. Null when nothing is set, which is the
 * caller's signal to use its plain unfiltered copy instead.
 *
 * The year is dropped from the first day of a same-year range: it is stated
 * once at the end, and repeating it reads like two separate years.
 */
export function formatRangeLabel(range) {
  const { from, to } = range ?? EMPTY_RANGE
  if (from && to) {
    const sameYear = from.slice(0, 4) === to.slice(0, 4)
    const formatter = sameYear ? DAY_FORMAT_NO_YEAR : DAY_FORMAT
    return `between ${formatter.format(parseDay(from))} and ${DAY_FORMAT.format(parseDay(to))}`
  }
  if (from) return `on or after ${DAY_FORMAT.format(parseDay(from))}`
  if (to) return `on or before ${DAY_FORMAT.format(parseDay(to))}`
  return null
}
