// Strava StreamSet -> RawTrackpoint[]. Pure: no fetch, no clock, no DOM.
//
// **This is where the Strava adapter earns its place, and it is why there is
// no new parser.** The real port on the domain side is `RawTrackpoint[]`, not
// `File` — normalizeActivity never sees a file — so a provider that hands back
// parallel arrays instead of a recorded file satisfies the same contract by
// assembling them. Everything downstream (distance axis, speed, pause
// detection, sampling interval, available metrics) is shared, unchanged, with
// the three file parsers.
//
// **Field mapping only, no interpretation** — the same rule parseFit, parseTcx
// and parseGpx state. Two consequences worth naming because both look like
// omissions:
//
//   - `moving` is never requested and would be ignored if it arrived.
//     normalizeActivity derives pauses via detectPauses, so a Strava activity
//     and its own FIT file get the same pauses from the same code. There is
//     deliberately no `moving` read anywhere below for a later change to
//     extend.
//   - `velocity_smooth` IS mapped, into `speedMps`, and that has a real
//     consequence: deriveSpeed.js short-circuits the moment any trackpoint
//     carries `speedMps`, so **Strava's pre-smoothed speed drives every pace
//     chart on this path**, and the same activity will not numerically match
//     the chart its own FIT file produces. That is a knowing trade, not a bug:
//     it is Strava's own displayed number, and inventing a different one would
//     be interpretation. The fixture cross-check asserts a tolerance rather
//     than equality, and asserting that tolerance is itself the finding.
//
// **Nulls are omitted, never emitted.** Strava reports a sensor dropout as a
// `null` at that index. normalizeActivity's `hasAnyData` tests `!= null`, so a
// literal null would behave correctly — but every other adapter in this repo
// produces either a number or an absent/null key, and a `RawTrackpoint`
// carrying `heartRateBpm: null` alongside one carrying no key at all would be
// two spellings of one thing.
import { StravaApiError } from './stravaApi.js'

/**
 * Mirrors parseGpx.js's `finiteOrNull`, except it returns `undefined` so the
 * key can be dropped entirely rather than set to null. `null`, `undefined`,
 * NaN and Infinity are all "the sensor said nothing here".
 */
function finiteOrUndefined(value) {
  return Number.isFinite(value) ? value : undefined
}

/**
 * A stream's `data` array, or null when the stream is absent or malformed.
 * Strava omits a stream entirely when the activity has no such sensor, which
 * is the common case — a phone-recorded run has no `watts`.
 */
function dataOf(streams, key) {
  const data = streams?.[key]?.data
  return Array.isArray(data) ? data : null
}

/**
 * Reads index `i` from a stream, bounds-checked.
 *
 * **The bounds check is not defensive decoration.** Strava normally returns
 * every stream at the same length as `time`, and "normally" is not a contract:
 * a stream that is one element short would otherwise read `undefined` at the
 * last index and — through `Number.isFinite(undefined)` being false — quietly
 * drop that sample's value, which is the correct outcome and only correct by
 * accident. Reading past the end of an array is the kind of thing that stops
 * being harmless the moment someone changes how the value is used.
 */
function at(data, i) {
  return data !== null && i < data.length ? data[i] : undefined
}

/**
 * @param {object} input
 * @param {object} input.streams Strava's StreamSet, `key_by_type=true`
 * @param {Date} input.startTime the activity's true UTC start, from the ref's
 *   `startedAtUtc` (Strava's `start_date`). **Not `start_date_local`** — that
 *   value carries a bogus trailing `Z` on what is really wall clock, so using
 *   it here would shift every timestamp by the athlete's own offset.
 * @param {import('../../domain/types.js').Sport} input.sport resolved BEFORE
 *   assembly, because cadence doubling depends on it — see below.
 * @returns {import('../../domain/types.js').RawTrackpoint[]}
 */
export function streamsToTrackpoints({ streams, startTime, sport }) {
  // RULE 1: `time` is the spine and is mandatory. RawTrackpoint.time is
  // non-optional and normalizeActivity calls .getTime() on it unguarded, so
  // there is no such thing as a trackpoint without one. An activity with no
  // time stream has no telemetry at all — a manual entry, or one still
  // processing.
  const time = dataOf(streams, 'time')
  if (!time || time.length === 0) throw new StravaApiError('no_streams')

  const startMs = startTime.getTime()
  if (!Number.isFinite(startMs)) throw new StravaApiError('no_streams')

  const distance = dataOf(streams, 'distance')
  const altitude = dataOf(streams, 'altitude')
  const heartrate = dataOf(streams, 'heartrate')
  const cadence = dataOf(streams, 'cadence')
  const watts = dataOf(streams, 'watts')
  const velocity = dataOf(streams, 'velocity_smooth')
  const latlng = dataOf(streams, 'latlng')
  // `moving` is deliberately unread. See the header — detectPauses owns this
  // question for every format. Do not add it.

  // RULE 6, and the trap this whole module is arranged around: **Strava's
  // `cadence` stream is RPM, and for a foot sport that is ONE LEG** (~85 for a
  // run at ~170 spm). `RawTrackpoint.cadenceSpm` is contractually
  // already-doubled — parseFit.js:40 does exactly this conversion, verified
  // against a session's own avgCadence. Miss it and every Strava run charts at
  // half its real cadence, and **nothing throws**. This is why `sport` is an
  // argument resolved before assembly rather than something derived after it.
  const cadenceFactor = sport === 'cycling' ? 1 : 2

  const trackpoints = []
  // RULE 2: the length is `time`'s. Every other stream is read by index,
  // bounds-checked, and is allowed to be absent or ragged.
  for (let i = 0; i < time.length; i++) {
    const offsetS = time[i]
    // A non-finite offset cannot be placed on the timeline at all. Dropped
    // rather than turned into an Invalid Date, which would poison every
    // interval computed from it downstream.
    if (!Number.isFinite(offsetS)) continue

    /** @type {import('../../domain/types.js').RawTrackpoint} */
    // RULE 3: absolute time = start + offset. No second API request; the
    // start instant rode in on the ref.
    const tp = { time: new Date(startMs + offsetS * 1000) }

    // RULE 4: assign only what the sensor actually reported. `finiteOrUndefined`
    // turns a dropout into an absent key.
    const distanceMeters = finiteOrUndefined(at(distance, i))
    if (distanceMeters !== undefined) tp.distanceMeters = distanceMeters

    const altitudeMeters = finiteOrUndefined(at(altitude, i))
    if (altitudeMeters !== undefined) tp.altitudeMeters = altitudeMeters

    const heartRateBpm = finiteOrUndefined(at(heartrate, i))
    if (heartRateBpm !== undefined) tp.heartRateBpm = heartRateBpm

    const rpm = finiteOrUndefined(at(cadence, i))
    if (rpm !== undefined) tp.cadenceSpm = rpm * cadenceFactor

    const power = finiteOrUndefined(at(watts, i))
    if (power !== undefined) tp.watts = power

    const speedMps = finiteOrUndefined(at(velocity, i))
    if (speedMps !== undefined) tp.speedMps = speedMps

    // RULE 5: `latlng` entries are `[lat, lng]` *arrays*, unlike every other
    // stream's scalars — so the shape is checked before destructuring. A
    // dropout here is a null in place of the pair, not a pair of nulls.
    const position = at(latlng, i)
    if (Array.isArray(position) && position.length >= 2) {
      const lat = finiteOrUndefined(position[0])
      const lon = finiteOrUndefined(position[1])
      // Both or neither: half a coordinate is not a position, and
      // buildDistanceAxis reads the pair.
      if (lat !== undefined && lon !== undefined) {
        tp.lat = lat
        tp.lon = lon
      }
    }

    trackpoints.push(tp)
  }

  return trackpoints
}
