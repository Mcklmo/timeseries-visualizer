// FIT -> FIT: keep only the records inside a wall-clock window and rewrite the
// summaries so the result stands alone as its own activity. The other
// direction of parseFit.js, which is why it lives beside it.
//
// Nothing here knows about Activity, samples or the zoom — bytes and two Dates
// in, bytes out. The caller (ui/ExportFitButton.jsx) is what turns the zoom
// window into that pair of Dates; see ARCHITECTURE.md §0 for why the mapping is
// a one-liner (`activity.startTime + sample.t * 1000`).
//
// Like parseFit, this dynamically imports @garmin/fitsdk (~1.3 MB, almost all
// of it the Profile table) so the export path costs nothing until it is used.

/**
 * Messages copied through untouched, in their original order.
 *
 * All of them are static identity/config: who recorded the file, on what, with
 * which profile. Replaying them in the order they were decoded is also what
 * satisfies FIT's one ordering requirement here — DEVELOPER_DATA_ID and
 * FIELD_DESCRIPTION must precede any record carrying a developer field — for
 * free, because devices write every definition before the record stream.
 *
 * @param {object} Profile
 * @returns {Set<number>}
 */
function copiedVerbatimMesgNums(Profile) {
  const M = Profile.MesgNum
  return new Set([
    M.FILE_ID,
    M.FILE_CREATOR,
    M.DEVELOPER_DATA_ID,
    M.FIELD_DESCRIPTION,
    M.DEVICE_INFO,
    M.DEVICE_SETTINGS,
    M.USER_PROFILE,
    M.SPORT,
    M.TRAINING_SETTINGS,
    M.ZONES_TARGET,
  ])
}

// Everything else is either windowed (RECORD), recomputed (SESSION, LAP,
// ACTIVITY, EVENT) or deliberately dropped:
//
//   HRV (78) and GPS_METADATA (160) carry no timestamp at all — they are
//   positioned only by their place in the stream, so there is no honest way to
//   decide which of them fall inside the window. Dropping beats guessing.
//
//   SPLIT/SPLIT_SUMMARY/TIME_IN_ZONE/TIMESTAMP_CORRELATION describe the WHOLE
//   activity; keeping them would have the trimmed file assert totals that its
//   own records contradict.
//
// A further class is lost involuntarily: any message whose global number is
// absent from the SDK's Profile (~2090 of them in the Garmin fixture —
// undocumented telemetry). MesgDefinition throws on an unknown mesgNum, so the
// Encoder physically cannot write them back. Nothing this app charts is among
// them, but that is why the export is not a byte-preserving cut.

/** Finite numbers only — an absent channel must not reach Math.max as NaN. */
function numericValues(records, field) {
  const out = []
  for (const record of records) {
    const value = record[field]
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  }
  return out
}

/** Same, for a field that has an `enhanced` variant (FIT's wider-range twin). */
function enhancedOrPlain(records, enhancedField, plainField) {
  const out = []
  for (const record of records) {
    const value = record[enhancedField] ?? record[plainField]
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  }
  return out
}

// Loop rather than Math.max(...values): a long activity is tens of thousands of
// records, and spreading that many arguments overflows the call stack.
function maxOf(values) {
  let max = -Infinity
  for (const value of values) if (value > max) max = value
  return max
}

function minOf(values) {
  let min = Infinity
  for (const value of values) if (value < min) min = value
  return min
}

function meanOf(values) {
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

/**
 * Assigns `key` only when `value` is a usable number.
 *
 * The whole point: a field with no honest derivation must be ABSENT from the
 * summary, never present-but-wrong. Writing `-Infinity` (Math.max of nothing)
 * or a prorated guess produces a file that reads as authoritative and lies.
 */
function setIfFinite(target, key, value) {
  if (typeof value === 'number' && Number.isFinite(value)) target[key] = value
}

/**
 * The one summary object SESSION and LAP are both built from.
 *
 * Derived from the windowed records' own RAW FIT VALUES rather than from
 * Activity.samples: the domain layer's samples are in the app's units with the
 * app's derivations applied (cadence doubled, pauses detected), and rebuilding
 * a FIT summary from them would both drag `domain/` into this module and write
 * numbers back in the wrong units.
 *
 * @param {object[]} kept - windowed records, distances already re-based
 * @param {object} originalSession - the source SESSION message, or {}
 * @param {object} sportMesg - the source SPORT message, or {}
 */
function summarizeRecords(kept, originalSession, sportMesg) {
  const first = kept[0]
  const last = kept[kept.length - 1]
  const elapsedS = (last.timestamp - first.timestamp) / 1000

  const distances = numericValues(kept, 'distance')
  const speeds = enhancedOrPlain(kept, 'enhancedSpeed', 'speed')
  const heartRates = numericValues(kept, 'heartRate')
  const cadences = numericValues(kept, 'cadence')
  const altitudes = enhancedOrPlain(kept, 'enhancedAltitude', 'altitude')
  const lats = numericValues(kept, 'positionLat')
  const lons = numericValues(kept, 'positionLong')

  // Post-rebase, so this is just the last cumulative reading — but expressed as
  // a difference anyway, so it stays correct if the first kept record had no
  // distance of its own and the rebase found its base further along.
  const totalDistance = distances.length > 0 ? distances[distances.length - 1] - distances[0] : null

  const summary = {
    timestamp: last.timestamp,
    startTime: first.timestamp,
    totalElapsedTime: elapsedS,
    // Equal to elapsed by construction: the window is a slice of wall clock,
    // and the app has no view of which seconds inside it the device had the
    // timer paused. Overstating moving time is the honest failure here —
    // understating it would flatter every average computed from it.
    totalTimerTime: elapsedS,
    messageIndex: 0,
  }

  setIfFinite(summary, 'totalDistance', totalDistance)
  if (totalDistance != null && elapsedS > 0) summary.enhancedAvgSpeed = totalDistance / elapsedS
  if (speeds.length > 0) summary.enhancedMaxSpeed = maxOf(speeds)

  if (heartRates.length > 0) {
    // FIT stores these as integers; a fractional mean would be truncated by the
    // encoder anyway, so round it here where the intent is visible.
    summary.avgHeartRate = Math.round(meanOf(heartRates))
    summary.maxHeartRate = maxOf(heartRates)
  }
  if (cadences.length > 0) {
    summary.avgCadence = Math.round(meanOf(cadences))
    summary.maxCadence = maxOf(cadences)
  }

  // Needs two readings to have a delta at all; one altitude sample is not a
  // zero-ascent activity, it is an unknown one.
  if (altitudes.length > 1) {
    let ascent = 0
    let descent = 0
    for (let i = 1; i < altitudes.length; i++) {
      const delta = altitudes[i] - altitudes[i - 1]
      if (delta > 0) ascent += delta
      else descent -= delta
    }
    summary.totalAscent = Math.round(ascent)
    summary.totalDescent = Math.round(descent)
  }

  setIfFinite(summary, 'startPositionLat', first.positionLat)
  setIfFinite(summary, 'startPositionLong', first.positionLong)
  setIfFinite(summary, 'endPositionLat', last.positionLat)
  setIfFinite(summary, 'endPositionLong', last.positionLong)
  if (lats.length > 0 && lons.length > 0) {
    // NEC/SWC = north-east and south-west corners of the bounding box, in
    // semicircles (signed, so max/min work directly).
    summary.necLat = maxOf(lats)
    summary.necLong = maxOf(lons)
    summary.swcLat = minOf(lats)
    summary.swcLong = minOf(lons)
  }

  // Carried across, not re-derived: this is what keeps parseFit's sport check
  // and deriveWorkoutName's "Trail Run" label working when the trimmed file is
  // dropped back into the app. SPORT is the fallback because a file can carry
  // one without a SESSION.
  const sport = originalSession.sport ?? sportMesg.sport
  const subSport = originalSession.subSport ?? sportMesg.subSport
  const sportProfileName = originalSession.sportProfileName ?? sportMesg.name
  if (sport != null) summary.sport = sport
  if (subSport != null) summary.subSport = subSport
  if (sportProfileName != null) summary.sportProfileName = sportProfileName

  // Everything with no honest derivation is OMITTED rather than prorated:
  // totalCalories, totalTrainingEffect, trainingLoadPeak, the respiration and
  // running-dynamics averages. A calorie count scaled by time is a fabricated
  // number that looks real.
  return summary
}

/**
 * Trim a FIT file to a wall-clock window.
 *
 * @param {ArrayBuffer} buffer - the original FIT file, already inflated
 * @param {{from: Date, to: Date}} window - inclusive at both ends, in the
 *   file's own wall clock
 * @returns {Promise<Uint8Array>} the trimmed file's bytes
 */
export async function trimFit(buffer, { from, to }) {
  const { Decoder, Encoder, Profile, Stream } = await import('@garmin/fitsdk')

  const decoder = new Decoder(Stream.fromArrayBuffer(buffer))
  if (!decoder.isFIT()) {
    throw new Error("Couldn't read that file — it isn't a valid FIT file")
  }

  /** @type {{mesgNum: number, mesg: object}[]} */
  const decoded = []
  /** @type {Record<string, object>} */
  const fieldDescriptions = {}
  const { errors } = decoder.read({
    // ⚠️ All three of these are load-bearing, not stylistic. The SDK's default
    // expansions synthesize extra field keys onto each decoded message
    // (sub-fields, component-expanded values, merged HR), and the Encoder's
    // MesgDefinition writes every key it recognises from the Profile — so
    // leaving them on would write DERIVED values back into the file as though
    // the device had recorded them.
    //
    // applyScaleAndOffset, convertTypesToStrings and convertDateTimesToDates
    // stay at their defaults: the Encoder un-applies each on the way out, so
    // the round trip is lossless through them.
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
    mesgListener: (mesgNum, mesg) => decoded.push({ mesgNum, mesg }),
    // Its three arguments are exactly addDeveloperField's signature, which is
    // what carries a Stryd pod's developer-field power across to the new file.
    fieldDescriptionListener: (key, developerDataIdMesg, fieldDescriptionMesg) => {
      fieldDescriptions[key] = { developerDataIdMesg, fieldDescriptionMesg }
    },
  })

  if (errors.length > 0) {
    throw new Error("Couldn't read that file — it isn't a valid FIT file")
  }

  const M = Profile.MesgNum
  const records = decoded.filter((d) => d.mesgNum === M.RECORD).map((d) => d.mesg)
  const inWindow = records.filter((r) => r.timestamp >= from && r.timestamp <= to)

  if (inWindow.length < 2) {
    throw new Error("That zoom window doesn't contain enough of this file to export")
  }

  // ⚠️ THE REBASE. FIT's record.distance is cumulative from the parent
  // activity's start, so a window at minute 10 opens at ~1481 m. Nothing
  // downstream subtracts that for us — domain/buildDistanceAxis.js reads
  // record.distance verbatim — so without this the re-imported file reports
  // roughly twice the true windowed distance, a wrong number that looks
  // entirely plausible. Real devices start at 0; a trimmed file must too.
  const baseDistance = numericValues(inWindow, 'distance')[0] ?? 0
  const kept = inWindow.map((record) =>
    typeof record.distance === 'number' ? { ...record, distance: record.distance - baseDistance } : record,
  )

  const first = kept[0]
  const last = kept[kept.length - 1]
  const elapsedS = (last.timestamp - first.timestamp) / 1000

  const originalSession = decoded.find((d) => d.mesgNum === M.SESSION)?.mesg ?? {}
  const originalActivity = decoded.find((d) => d.mesgNum === M.ACTIVITY)?.mesg ?? {}
  const sportMesg = decoded.find((d) => d.mesgNum === M.SPORT)?.mesg ?? {}
  const summary = summarizeRecords(kept, originalSession, sportMesg)

  // Timestamps stay ABSOLUTE. A window from 04:50–05:00 really happened then,
  // and re-basing it onto the parent's start would make the file lie about when
  // it was recorded. normalizeActivity rebases sample.t on re-import anyway, so
  // shifting them would buy nothing and cost the truth.
  const encoder = new Encoder({ fieldDescriptions })
  const verbatim = copiedVerbatimMesgNums(Profile)
  for (const { mesgNum, mesg } of decoded) {
    if (verbatim.has(mesgNum)) encoder.onMesg(mesgNum, mesg)
  }

  encoder.onMesg(M.EVENT, { timestamp: first.timestamp, event: 'timer', eventType: 'start', eventGroup: 0 })
  for (const record of kept) encoder.onMesg(M.RECORD, record)
  encoder.onMesg(M.EVENT, { timestamp: last.timestamp, event: 'timer', eventType: 'stopAll', eventGroup: 0 })

  encoder.onMesg(M.LAP, { ...summary, event: 'lap', eventType: 'stop', lapTrigger: 'sessionEnd' })
  encoder.onMesg(M.SESSION, {
    ...summary,
    event: 'session',
    eventType: 'stop',
    trigger: 'activityEnd',
    firstLapIndex: 0,
    numLaps: 1,
  })

  const activityMesg = { ...originalActivity, timestamp: last.timestamp, totalTimerTime: elapsedS, numSessions: 1 }
  // localTimestamp decodes as a raw number (FIT's local_date_time), not a Date,
  // so it is shifted by the same second delta as `timestamp` rather than
  // recomputed — that preserves the file's local-time offset without this
  // module needing to know the athlete's time zone.
  if (typeof originalActivity.localTimestamp === 'number' && originalActivity.timestamp != null) {
    const shiftS = Math.round((last.timestamp - originalActivity.timestamp) / 1000)
    activityMesg.localTimestamp = originalActivity.localTimestamp + shiftS
  }
  encoder.onMesg(M.ACTIVITY, activityMesg)

  return encoder.close()
}
