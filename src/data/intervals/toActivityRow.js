// intervals.icu's wire shape → the provider-neutral ActivityRow. This is the
// only module in the repo allowed to know that a distance is called
// `icu_distance` and a start time `start_date_local`; everything downstream of
// useIntervalsActivities — the merge, the date predicate, the list — sees rows.
//
// It sits beside intervalsApi.js rather than inside it on purpose:
// intervalsApi.js stays the raw transport, and its tests keep pinning the
// literal wire shape. Mapping is a separate question from fetching, and Strava
// will answer it in its own file with the same signature.
//
// **Every field but `id` is optional.** Strava-sourced rows come back as
// near-empty stubs where `id` may genuinely be the only property present, so
// no guard here may assume anything else exists.

/**
 * Why a row can't be loaded, or null if it can. Order matters: the specific
 * reasons are checked before the catch-all stub case, so a row that says
 * enough about itself gets the message that actually helps.
 *
 * `file_type` being absent is deliberately *not* a reason — the bytes are the
 * authority (detectActivityFormat.js) and this is only a pre-flight guard.
 *
 * Raw-shaped by nature: every question it asks is about a provider's own
 * fields, which is why it belongs on this side of the boundary rather than in
 * the list component it used to live in.
 */
export function unsupportedReason(activity) {
  if (activity.source === 'STRAVA') {
    return "Synced from Strava — intervals.icu doesn't keep the original file."
  }
  const fileType = activity.file_type?.toLowerCase()
  if (fileType && !['fit', 'tcx', 'gpx'].includes(fileType)) {
    return "This file type isn't supported."
  }
  // Strava-sourced activities come back as near-empty stubs where `id` may be
  // the only property present — so this catches the ones that didn't even say
  // they were from Strava.
  if (!activity.name && !activity.start_date_local) {
    return "This activity's details aren't available."
  }
  return null
}

/**
 * A measurement the API reported, or null. Zero and negative are treated as
 * "didn't say" rather than rendered: a 0 m ride is a gap in the data, and
 * `0.00 km` on a row reads as a fact the athlete then has to disbelieve.
 */
function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * @param {object} activity - one raw intervals.icu activity (see intervalsApi.js)
 * @returns {import('../activityRow.js').ActivityRow}
 */
export function toActivityRow(activity) {
  return {
    id: activity.id,
    // `||`, not `??`. An empty-string name has to fall through the same way a
    // missing one does — to the list's 'Untitled activity' placeholder, and to
    // an id ref with no `name`, so the chart keeps the title deriveWorkoutName
    // inferred rather than being handed a blank one. LOAD-BEARING: `??` keeps
    // the empty string and breaks both.
    name: activity.name || undefined,
    // No trailing Z is added: `start_date_local` is already the athlete's wall
    // clock, and appending one shifts it into their own offset a second time.
    startedAt: activity.start_date_local ?? null,
    distanceM: positiveNumber(activity.icu_distance),
    // `moving_time` first: it is what an athlete reads as the duration of the
    // session. `elapsed_time` is the fallback for the sources that only report
    // the one.
    durationS: positiveNumber(activity.moving_time ?? activity.elapsed_time),
    sportLabel: activity.type ?? null,
    unsupportedReason: unsupportedReason(activity),
    // intervals.icu's API Terms §1.1 requires Garmin attribution on anything
    // derived from Garmin-sourced data, and Strava's API Policy §4.4 requires
    // the same — so this is a shared question, answered per provider. The
    // attribution *sentence* stays in each page, where its wording differs.
    isGarminDerived: activity.source === 'GARMIN_CONNECT' || Boolean(activity.device_name),
  }
}
