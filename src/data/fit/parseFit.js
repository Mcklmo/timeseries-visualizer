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

function parseTrackpoint(record, powerKey) {
  const time = record.timestamp ?? null

  // Standard field checked first so a non-Stryd power meter that *does*
  // populate field 7 natively still works.
  const watts = record.power ?? (powerKey != null ? (record.developerFields?.[powerKey] ?? null) : null)

  // FIT's record.cadence is per-leg (strides/min), same as TCX's RunCadence
  // — double it for steps/min. Verified against this fixture's
  // session.avgCadence (84) vs. the raw per-record mean (83.75).
  const cadenceSpm = record.cadence != null ? record.cadence * 2 : null

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
 * @returns {Promise<{id: string, sport: import('../../domain/types.js').Sport, trackpoints: import('../../domain/types.js').RawTrackpoint[]}>}
 */
export async function parseFit(buffer) {
  const { Decoder, Stream } = await import('@garmin/fitsdk')
  const stream = Stream.fromArrayBuffer(buffer)
  const { messages, errors } = new Decoder(stream).read()

  if (errors.length > 0 || !messages.recordMesgs) {
    throw new Error("Couldn't read that file — it isn't a valid FIT file")
  }

  // Absent session data isn't blocked on — v1 is running-only regardless,
  // same scope TCX parsing already assumes, and FIT doesn't require a
  // session message to have valid records.
  const sport = messages.sessionMesgs?.[0]?.sport
  if (sport != null && sport !== 'running') {
    throw new Error(`Only running activities are supported right now (this file is "${sport}")`)
  }

  const powerKey = findPowerDevFieldKey(messages.fieldDescriptionMesgs ?? [])

  const trackpoints = messages.recordMesgs
    .map((record) => parseTrackpoint(record, powerKey))
    .filter((tp) => tp.time != null) // a trackpoint with no timestamp can't be placed on any axis

  if (trackpoints.length === 0) {
    throw new Error("That FIT file doesn't contain any trackpoints")
  }

  // FIT has no direct equivalent of TCX's <Id>, and no code downstream
  // consumes this id, so a timestamp fallback (same kind TCX uses for a
  // missing <Id>) is enough.
  const id = `fit-${Date.now()}`

  return { id, sport: 'running', trackpoints }
}
