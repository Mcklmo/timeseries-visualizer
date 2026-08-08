// SI is the internal currency everywhere else in the app. This is the only
// file allowed to know about display units — see ARCHITECTURE.md §2.

const METRES_PER_KM = 1000
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400

/** @param {number} speedMps @returns {number|null} seconds per km, or null if not meaningful */
export function mpsToSecPerKm(speedMps) {
  if (!(speedMps > 0)) return null
  return METRES_PER_KM / speedMps
}

/** @param {number} speedMps @returns {number} km/h */
export function mpsToKmh(speedMps) {
  return speedMps * 3.6
}

/** @param {number|null|undefined} kmh @returns {string} e.g. 28.42 -> '28.4' */
export function formatSpeedKmh(kmh) {
  if (kmh == null || !Number.isFinite(kmh)) return '–'
  return kmh.toFixed(1)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** @param {number|null|undefined} secPerKm @returns {string} e.g. 287 -> '4:47' */
export function formatPace(secPerKm) {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return '–'
  const total = Math.round(secPerKm)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${pad2(sec)}`
}

/**
 * @param {number} seconds
 * @returns {string} m:ss, escalating to h:mm:ss at an hour and 'Nd h:mm:ss' at a day
 */
export function formatDuration(seconds) {
  const total = Math.round(seconds)
  // Hours used to run on past 24 — a three-day satellite track read "72:00:00"
  // in the tooltip header. Output below a day is unchanged.
  const days = Math.floor(total / SECONDS_PER_DAY)
  const h = Math.floor((total % SECONDS_PER_DAY) / SECONDS_PER_HOUR)
  const m = Math.floor((total % SECONDS_PER_HOUR) / 60)
  const s = total % 60
  if (days > 0) return `${days}d ${h}:${pad2(m)}:${pad2(s)}`
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`
  return `${m}:${pad2(s)}`
}

/** @param {number} metres @returns {string} e.g. 3210 -> '3.21 km' */
export function formatDistanceKm(metres) {
  return `${(metres / METRES_PER_KM).toFixed(2)} km`
}

// Pinned to en-GB, and to 24-hour time, for the same reason
// IntervalsActivityList pins its row dates: day-before-month everywhere,
// stable enough to assert on, and a picker row and the header of the activity
// it loads should read the same way. No weekday here though — the pinned
// header cluster has to wrap onto one phone row, and the weekday identifies
// nothing the date doesn't.
//
// Rendered in the *viewer's* zone, which is the only one available: the parsed
// model keeps an absolute instant and no recording offset, so an activity
// exported from another timezone reads in local time. Right for the usual case
// (you look at your own runs from where you ran them) and honest about the
// rest — there is no offset to be faithful to.
const START_DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * @param {Date|null|undefined} startTime
 * @returns {string|null} e.g. '8 Aug 2026, 07:14' — null when there is nothing
 *   valid to print, so a caller renders no element at all rather than the
 *   'Invalid Date' that Intl would otherwise emit.
 */
export function formatStartDateTime(startTime) {
  if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime())) return null
  return START_DATE_TIME_FORMAT.format(startTime)
}

// Axis ticks are their own formatting problem: a tick has to stay short enough
// to sit under a gridline, and what "short" means depends entirely on how much
// ground the axis covers. "6:22" is the right tick for a half-hour run and
// useless for a three-day track. Both are factories rather than plain
// formatters because Recharts hands `tickFormatter` only the value, never the
// span — the band has to be closed over at build time.
//
// NO TICK LABEL MAY CONTAIN A SPACE. Recharts' <Text> splits a label on
// whitespace and stacks the words as separate <tspan dy="1em">s, i.e. "1d 0h"
// renders on two lines and the second one falls outside the axis band. Hence
// "1d0h" and "450m" rather than the spaced forms used elsewhere in the UI.

const SHORT_SPAN_S = 10 * 60 // below this, ticks read m:ss
const MEDIUM_SPAN_S = 3 * SECONDS_PER_HOUR // below this, h:mm
const HOURS_PER_DAY = 24

/**
 * @param {number} spanS - total elapsed seconds the axis covers
 * @returns {(seconds: number) => string}
 */
export function makeElapsedTickFormatter(spanS) {
  // formatDuration is space-free below an hour, which is the only range this
  // band covers. An unknown span gets the finest band rather than the coarsest.
  if (!(spanS >= SHORT_SPAN_S)) return formatDuration // 0:00 · 2:30 · 5:00
  if (spanS < MEDIUM_SPAN_S) {
    return (seconds) => {
      const totalMin = Math.round(seconds / 60)
      return `${Math.floor(totalMin / 60)}:${pad2(totalMin % 60)}` // 0:00 · 0:30 · 1:00
    }
  }
  if (spanS < SECONDS_PER_DAY) return (seconds) => `${Math.round(seconds / SECONDS_PER_HOUR)}h` // 0h · 6h · 12h
  return (seconds) => {
    const totalH = Math.round(seconds / SECONDS_PER_HOUR)
    const days = Math.floor(totalH / HOURS_PER_DAY)
    const h = totalH % HOURS_PER_DAY
    return days > 0 ? `${days}d${h}h` : `${h}h` // 0h · 1d0h · 2d0h
  }
}

/**
 * @param {number} spanM - total metres the axis covers
 * @returns {(metres: number) => string}
 */
export function makeDistanceTickFormatter(spanM) {
  if (!(spanM >= METRES_PER_KM)) return (metres) => `${Math.round(metres)}m`
  return (metres) => `${(metres / METRES_PER_KM).toFixed(1)}km`
}
