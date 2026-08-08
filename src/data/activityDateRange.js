// The date-range filter's whole model, in one pure module: no React, no DOM,
// zero imports. A picker hook owns the state and a date-filter component
// renders it; both read their rules from here.
//
// It filters `ActivityRow`s, not any provider's raw payload, which is what
// finally let it out of `data/intervals/`. `toApiDate` came with it: it had
// two consumers, both date-range concerns, and leaving it behind in
// intervalsApi.js was the single import that pinned this module to one
// provider.
//
// **A range is two `YYYY-MM-DD` strings, never two Dates.** That is exactly
// what `<input type="date">`.value reads and writes regardless of display
// locale, it is already intervals.icu's wire format, and — the part that
// matters — lexicographic comparison of `YYYY-MM-DD` *is* chronological
// comparison. So the predicate, the `from <= to` check and the request bounds
// are all plain string operations, sidestepping every timezone trap the
// providers' folders carry warnings about. Dates appear only where a calendar
// has to be walked (`dayAfter`) or formatted (`formatRangeLabel`), and both go
// through `parseDay` for the reason documented there.
//
// A provider whose API wants something other than a day string converts at its
// own boundary — Strava's `before`/`after` are epoch seconds, so
// `data/strava/stravaBoundsFor.js` sits on top of this rather than inside it.

/**
 * `YYYY-MM-DD` in the **local** calendar. `toISOString().slice(0, 10)` is the
 * obvious spelling and is wrong: it is UTC, so it silently shifts a window by
 * a day for anyone not on UTC, dropping or duplicating a day's activities at
 * the boundary. intervals.icu compares `oldest`/`newest` against
 * `start_date_local`, and every other consumer here is likewise reasoning
 * about the athlete's own calendar.
 * @param {Date} date
 */
export function toApiDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * No filter. Not a state the UI offers any more — the page starts at
 * `defaultRange()` and ↺ returns there — but still reachable by emptying both
 * fields by hand, and still what `formatRangeLabel` falls back to.
 */
export const EMPTY_RANGE = { from: null, to: null }

/** @typedef {{from: string | null, to: string | null}} DateRange */

/** Either bound set — one open end is still a filter. */
export function isRangeActive(range) {
  return Boolean(range?.from || range?.to)
}

/**
 * Range equality — "is this still the default?", which is what decides whether
 * the ↺ is worth showing, and the presets' `aria-pressed`.
 */
export function isSameRange(a, b) {
  return a?.from === b?.from && a?.to === b?.to
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
 * The calendar day a row's activity happened on, or null when it didn't say.
 *
 * This is the **single** parser for `ActivityRow.startedAt` on the filtering
 * path — `activityInRange` and `widenedStart` both go through it.
 * `ActivityRowList`'s `formatStartDate` keeps its own, deliberately: it needs
 * the `Date` itself to hand to `Intl`, so routing it through here would only
 * mean parsing twice. Do not add a fourth copy.
 *
 * No trailing Z is added: `startedAt` is already the athlete's wall clock, and
 * appending one shifts it into their own offset a second time. The mapper that
 * fills the field has the same rule for the same reason.
 *
 * @param {import('./activityRow.js').ActivityRow} [row]
 */
export function startDayOf(row) {
  const startedAt = row?.startedAt
  if (!startedAt) return null
  const date = new Date(startedAt)
  return Number.isNaN(date.getTime()) ? null : toApiDate(date)
}

/**
 * Inclusive at both ends — "1 Mar to 31 Mar" means the whole of both days,
 * which is what the two fields read as. Comparing calendar days rather than
 * instants is what makes a 23:50 activity on the `to` day pass.
 *
 * A row with no usable date **passes when no range is set and fails when one
 * is**. Both halves are deliberate: a Strava stub cannot honestly be claimed
 * to fall in March, but it must stay visible (disabled, with its reason) in
 * the default view — ActivityRowList's rule is that an activity the athlete
 * knows they recorded is never silently hidden.
 *
 * @param {import('./activityRow.js').ActivityRow} row
 * @param {DateRange} range
 */
export function activityInRange(row, range) {
  if (!isRangeActive(range)) return true
  const day = startDayOf(row)
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

/** The mirror of `dayAfter`, and `setDate`'s overflow handling is what makes
 *  it correct across month and year boundaries too. */
function daysBefore(day, days) {
  const date = parseDay(day)
  date.setDate(date.getDate() - days)
  return toApiDate(date)
}

/**
 * What to ask `/activities` for, given the range and the floor to fall back on
 * when the athlete emptied the start field by hand — the range's own `from` is
 * the floor in every other case.
 *
 * **The `+ 1 day` on `newest` is the entire point of this function.** The API
 * reads `newest=<day>` as midnight *at the start* of that day (see
 * intervalsApi.js), so an inclusive end date has to be sent as the day after —
 * otherwise a range ending today returns nothing recorded today, which is the
 * single easiest thing to get wrong here. `newest` is omitted entirely when
 * `to` is unset, restoring the endpoint's own default of "up to now".
 *
 * @param {DateRange} range
 * @param {string} fallbackOldest - `YYYY-MM-DD`, the default range's start
 * @returns {{oldest: string, newest?: string}}
 */
export function requestBoundsFor(range, fallbackOldest) {
  const oldest = range?.from ?? fallbackOldest
  return range?.to ? { oldest, newest: dayAfter(range.to) } : { oldest }
}

/**
 * The next `from` for "Load earlier activities" — paging *is* widening the
 * range now, since the range is the only browse floor there is.
 *
 * Anchored on the oldest activity actually held, not on the range's own `from`
 * — those differ whenever a response came back capped, and `from` would then
 * claim to have covered ground that was never returned.
 *
 * The final guard keeps the button honest: it must always widen the range,
 * even when an empty or capped response left the anchor newer than where the
 * range already starts.
 *
 * `.sort()` on `YYYY-MM-DD` orders chronologically, which is the same property
 * the rest of this module is built on.
 *
 * @param {DateRange} range
 * @param {import('./activityRow.js').ActivityRow[]} rows
 * @param {number} days
 * @param {string} fallbackFrom - used when the start field was emptied by hand
 */
export function widenedStart(range, rows, days, fallbackFrom) {
  const currentFrom = range?.from ?? fallbackFrom
  const oldestHeldDay = rows.map(startDayOf).filter(Boolean).sort()[0]
  const anchor = oldestHeldDay ?? currentFrom
  const candidate = daysBefore(anchor, days)
  return candidate < currentFrom ? candidate : daysBefore(currentFrom, days)
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

/** Wide enough that a first load almost always fills the screen, narrow enough
 *  that it stays one quick request on a phone connection. */
export const DEFAULT_RANGE_DAYS = 90

/**
 * The filter's default and its reset target — the page starts here rather than
 * unfiltered. Also the browse floor, and the step "Load earlier activities"
 * widens by: IntervalsPage used to keep a separate `WINDOW_DAYS` window
 * alongside the range, and now that the range is the only floor there is,
 * there is one number in one place.
 */
export function defaultRange(today = new Date()) {
  return lastDays(today, DEFAULT_RANGE_DAYS)
}

/**
 * The one-tap ranges. Counted in **days, not calendar months**: `setMonth` on
 * the 31st silently overflows (31 May − 3 months is 3 March, not 28 February),
 * and nobody reading "3 months" here is asking for a precise calendar span —
 * they are asking for roughly the last season of training. 90 and 365 are also
 * exactly what the labels imply to an athlete.
 *
 * *3 months* reads through `DEFAULT_RANGE_DAYS` rather than a literal 90, so
 * the chip and the default cannot drift apart — that chip reading as pressed
 * on first paint is what tells the athlete the filter is already on.
 *
 * @type {{id: string, label: string, rangeFor: (today: Date) => DateRange}[]}
 */
export const PRESETS = [
  { id: '30d', label: '30 days', rangeFor: (today) => lastDays(today, 30) },
  { id: '3m', label: '3 months', rangeFor: (today) => lastDays(today, DEFAULT_RANGE_DAYS) },
  { id: '12m', label: '12 months', rangeFor: (today) => lastDays(today, 365) },
]

// Pinned to en-GB rather than the visitor's locale, matching DATE_FORMAT in
// ActivityRowList.jsx — the empty message names the same days the rows
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
