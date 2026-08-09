// Strava's `sport_type` -> this app's three sports, plus a human label.
// A lookup table, modelled on parseGpx.js's SPORT_BY_TRACK_TYPE.
//
// **`sport_type`, not `type`.** Strava's older `type` field collapses
// TrailRun, VirtualRun and Run into "Run" and is documented as deprecated;
// `sport_type` is the one that distinguishes them, which matters because the
// distinction is exactly what the label renders.
//
// **Everything unrecognised falls back to `track`, and nothing here throws.**
// `track` is defined in this app as "a generic GPS log with no sport of its
// own", and metricRegistry gives it every metric except pace. So a Swim, a
// Rowing or a Windsurf charts as speed + heart rate + altitude, which is
// correct rather than degraded — and strictly better than the file parsers,
// which throw on a sport they don't know. Strava adds sport types faster than
// this table can track them, and a new one appearing must not break the
// picker.
//
// **The honest cost of that fallback**, stated because it is silent: an
// unknown *foot* sport lands in `track`, and `track` is not a foot sport, so
// its cadence is not doubled (see streamsToTrackpoints.js). A future foot
// sport would chart at ~85 spm until it is added below. Nothing throws and
// nothing looks wrong; only the number is half what it should be.

/** @typedef {import('../../domain/types.js').Sport} Sport */

/** @type {Record<string, Sport>} */
const SPORT_BY_SPORT_TYPE = {
  Run: 'running',
  TrailRun: 'running',
  VirtualRun: 'running',
  // Walk and Hike are foot sports for cadence's sake, which is the only thing
  // `sport` decides here beyond which metrics get offered. Charting a hike's
  // pace is odd but not wrong, and the alternative — `track` — would halve its
  // cadence.
  Walk: 'running',
  Hike: 'running',
  Ride: 'cycling',
  MountainBikeRide: 'cycling',
  GravelRide: 'cycling',
  EBikeRide: 'cycling',
  EMountainBikeRide: 'cycling',
  VirtualRide: 'cycling',
  Handcycle: 'cycling',
  Velomobile: 'cycling',
}

/**
 * **Accepts either spelling — `'TrailRun'` or `'Trail Run'`.** Spaces are
 * stripped before the lookup, which is what lets the picker put the *humanized*
 * label on the row (where it is read by a human) and pass that same string
 * through `IdActivityRef.sportType` to the adapter (where it is read by this
 * table). One value travels, not two, so they cannot disagree — and the
 * alternative was a second sport field on the provider-neutral ActivityRow.
 *
 * @param {string} [sportType] Strava's `sport_type`, or its humanized form
 * @returns {Sport}
 */
export function sportFor(sportType) {
  if (typeof sportType !== 'string') return 'track'
  return SPORT_BY_SPORT_TYPE[sportType.replace(/\s+/g, '')] ?? 'track'
}

/**
 * `'TrailRun'` -> `'Trail Run'`. Feeds **`sportLabel`**, which is the sport
 * word on the picker row and in the derived activity name.
 *
 * NOT the activity title (see the T10 trap in the plan): `deriveWorkoutName`
 * prefixes a time-of-day bucket to whatever `sportLabel` says, so routing a
 * real Strava title through it produces "Morning Tempo 5×1k". Titles go
 * through `ref.name`, applied after normalize.
 *
 * Two passes so runs of capitals split correctly: `EBikeRide` -> `E Bike Ride`
 * rather than `EBike Ride`.
 *
 * @param {string} [sportType]
 * @returns {string|null}
 */
export function humanizeSportType(sportType) {
  if (!sportType || typeof sportType !== 'string') return null
  return sportType
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}
