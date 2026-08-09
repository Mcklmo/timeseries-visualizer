// The route, as parallel typed arrays of pre-projected Web Mercator
// coordinates. Built inside normalizeActivity from the SAME filtered
// trackpoint array the samples are built from, which is what makes
// `track.x[i]` and `activity.samples[i]` describe the same instant.
//
// WHY A PARALLEL STRUCTURE RATHER THAN lat/lon ON `Sample`. Three reasons, and
// the first is the one that decided it:
//
//  1. The render loop wants contiguous, already-projected numbers. Stroking a
//     20k-point route off `samples[i].lat` is 20k property reads through 20k
//     object shapes plus 20k calls to projectLatLon, per draw. Two Float64Arrays
//     are ~16 bytes per sample (≈320 KB on a long ride), read linearly, and the
//     projection is paid once at load.
//  2. `Sample`'s documented contract is "SI units, always" — scalar metrics
//     sampled over time. A coordinate pair is neither scalar nor a metric, and
//     nothing else in the app treats it as one: it has no registry entry, no
//     panel and no stats.
//  3. MetricPanel's hot row builder is `activity.samples.map(...)`, once per
//     metric per render. Widening `Sample` widens every one of those objects.
//
// **Float64Array, not Float32Array, and this is not premature.** Float32 holds
// ~7 significant decimal digits, which over the unit square works out to about
// 2.4 m of positional quantisation at the equator. Invisible at a full-route
// fit — one pixel is tens of metres there — but the moment anyone revisits the
// "map follows the zoom window" framing that was deliberately rejected, a
// 50× zoom puts that quantisation on screen as a visibly stepped route. The
// memory saved would be 160 KB on the longest ride this app sees.
import { projectLatLon } from './webMercator.js'

/**
 * A fix is a lat/lon pair that could actually have come off a GPS receiver.
 *
 * Out-of-range values are treated as ABSENT rather than clamped: a lat of 200
 * is a broken record, not a place, and clamping it to 85 would plant a
 * plausible-looking point in the Arctic and drag `bounds` — and therefore the
 * whole fit — out to the pole with it. A missing fix costs one gap in the
 * stroke; a fabricated one costs the entire framing.
 */
function isFix(lat, lon) {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  )
}

/**
 * @param {import('./types.js').RawTrackpoint[]} trackpoints - the `usable`
 *   array normalizeActivity has already filtered. **Must be the same array the
 *   samples are built from**, in the same order: nothing in the type system
 *   enforces the index alignment this returns, and the crosshair lookup rests
 *   on it entirely.
 * @returns {import('./types.js').Track|null} null when not one trackpoint
 *   carries a fix — a treadmill run, an indoor ride, a smart-trainer session.
 *   **That null is the map feature's entire availability gate**; nothing is
 *   added to `availableMetrics` (see the comment there).
 */
export function buildTrack(trackpoints) {
  if (!Array.isArray(trackpoints) || trackpoints.length === 0) return null

  const x = new Float64Array(trackpoints.length)
  const y = new Float64Array(trackpoints.length)

  let fixCount = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity

  for (let i = 0; i < trackpoints.length; i += 1) {
    const tp = trackpoints[i]
    if (!isFix(tp?.lat, tp?.lon)) {
      // NaN, not 0/0 and not "hold the previous fix forward". 0/0 is a real
      // place in the Gulf of Guinea and would draw a line to it; holding
      // forward would invent a stationary athlete where the receiver simply
      // lost sky. NaN is what drawRoute reads as "break the stroke here",
      // matching `connectNulls={false}` on the charts.
      x[i] = NaN
      y[i] = NaN
      continue
    }

    const point = projectLatLon(tp.lat, tp.lon)
    x[i] = point.x
    y[i] = point.y
    fixCount += 1

    // Over the FIXES ONLY — a NaN reaching either side of a comparison makes
    // it false, so the guard above is what keeps this arithmetic clean.
    if (point.x < x0) x0 = point.x
    if (point.x > x1) x1 = point.x
    if (point.y < y0) y0 = point.y
    if (point.y > y1) y1 = point.y
  }

  if (fixCount === 0) return null

  return { x, y, bounds: { x0, y0, x1, y1 }, fixCount }
}
