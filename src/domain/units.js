// SI is the internal currency everywhere else in the app. This is the only
// file allowed to know about display units — see ARCHITECTURE.md §2.

const METRES_PER_KM = 1000

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

/** @param {number} seconds @returns {string} m:ss, or h:mm:ss once an hour is reached */
export function formatDuration(seconds) {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`
  return `${m}:${pad2(s)}`
}

/** @param {number} metres @returns {string} e.g. 3210 -> '3.21 km' */
export function formatDistanceKm(metres) {
  return `${(metres / METRES_PER_KM).toFixed(2)} km`
}
