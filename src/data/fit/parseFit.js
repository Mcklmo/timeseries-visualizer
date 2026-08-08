// FIT (binary) -> RawTrackpoint[]. Pure field mapping, no domain logic
// (pauses, distance monotonicity, smoothing — all of that is
// normalizeActivity's job). See ARCHITECTURE.md §8 for the parsing gotchas
// this encodes, TCX's and FIT's alike.
//
// Unlike parseTcx, this is async: @garmin/fitsdk is ~1.3 MB (mostly its FIT
// field/message profile table), so it's dynamically imported here to keep
// it out of the eager bundle for TCX-only users.

const RECORD_MESG_NUM = 20 // FIT global message number for `record`
const POWER_NATIVE_FIELD_NUM = 7 // `record`'s standard power field number

// Power is often only present as a developer field (e.g. Stryd pods, whose
// FIT export doesn't populate the standard `record.power` field at all).
// Developer field values are keyed by a sequential `key` assigned during
// decode — not by fieldDefinitionNumber — so the key must be resolved via
// fieldDescriptionMesgs first, matched by which native field it mirrors.
function findPowerDevFieldKey(fieldDescriptionMesgs) {
  const byNativeField = fieldDescriptionMesgs.find(
    (fd) => fd.nativeMesgNum === RECORD_MESG_NUM && fd.nativeFieldNum === POWER_NATIVE_FIELD_NUM,
  )
  if (byNativeField) return byNativeField.key
  const byName = fieldDescriptionMesgs.find(
    (fd) => fd.nativeMesgNum === RECORD_MESG_NUM && fd.fieldName?.toLowerCase() === 'power',
  )
  return byName?.key ?? null
}

function parseTrackpoint(record, powerKey, sport) {
  const time = record.timestamp ?? null

  // Standard field checked first so a non-Stryd power meter that *does*
  // populate field 7 natively still works.
  const watts = record.power ?? (powerKey != null ? (record.developerFields?.[powerKey] ?? null) : null)

  // FIT's record.cadence is per-leg (strides/min) for running, same as TCX's
  // RunCadence — double it for steps/min. Verified against this fixture's
  // session.avgCadence (84) vs. the raw per-record mean (83.75). For cycling,
  // record.cadence is already pedal rpm — no doubling.
  const cadenceSpm = record.cadence == null ? null : sport === 'cycling' ? record.cadence : record.cadence * 2

  // positionLat/positionLong are raw semicircle integers; the SDK does not
  // auto-convert these. 2^31 semicircles = 180 degrees.
  const lat = record.positionLat != null ? record.positionLat * (180 / 2 ** 31) : null
  const lon = record.positionLong != null ? record.positionLong * (180 / 2 ** 31) : null

  return {
    time,
    distanceMeters: record.distance ?? null,
    altitudeMeters: record.enhancedAltitude ?? record.altitude ?? null,
    heartRateBpm: record.heartRate ?? null,
    cadenceSpm,
    watts,
    speedMps: record.enhancedSpeed ?? record.speed ?? null,
    lat,
    lon,
  }
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{sport: import('../../domain/types.js').Sport, sportLabel: (string|undefined), trackpoints: import('../../domain/types.js').RawTrackpoint[]}>}
 */
export async function parseFit(buffer) {
  const { Decoder, Stream } = await import('@garmin/fitsdk')
  const stream = Stream.fromArrayBuffer(buffer)
  const { messages, errors } = new Decoder(stream).read()

  if (errors.length > 0 || !messages.recordMesgs) {
    throw new Error("Couldn't read that file — it isn't a valid FIT file")
  }

  // Absent session data defaults to running rather than blocking — FIT
  // doesn't require a session message to have valid records, and running is
  // the far more common case among files that omit it.
  const rawSport = messages.sessionMesgs?.[0]?.sport
  const sport = rawSport == null ? 'running' : rawSport
  if (sport !== 'running' && sport !== 'cycling') {
    throw new Error(`Only running and cycling activities are supported right now (this file is "${sport}")`)
  }

  // The watch's sport-profile label (e.g. "Trail Run"), when the athlete
  // used a custom profile rather than the default. sessionMesgs and
  // sportMesgs are typically duplicates of each other — checked both since
  // either can be absent. Deliberately `||`, not `??`, at each step: an
  // empty-but-present sportProfileName string must still fall through to
  // sportMesgs[0].name, which `??` (only catches null/undefined) would miss.
  const sportLabel =
    messages.sessionMesgs?.[0]?.sportProfileName?.trim() || messages.sportMesgs?.[0]?.name?.trim() || undefined

  const powerKey = findPowerDevFieldKey(messages.fieldDescriptionMesgs ?? [])

  const trackpoints = messages.recordMesgs
    .map((record) => parseTrackpoint(record, powerKey, sport))
    .filter((tp) => tp.time != null) // a trackpoint with no timestamp can't be placed on any axis

  if (trackpoints.length === 0) {
    throw new Error("That FIT file doesn't contain any trackpoints")
  }

  return { sport, sportLabel, trackpoints }
}
