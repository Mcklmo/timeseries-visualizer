// Strava's SummaryActivity -> the provider-neutral ActivityRow. Same signature
// and same file position as data/intervals/toActivityRow.js, whose header
// already predicted this file: mapping is a separate question from fetching,
// and each provider answers it in its own module.
//
// This is the only place in the repo allowed to know that a Strava distance is
// called `distance` and a start time `start_date_local`. Everything downstream
// of useStravaActivities — the merge, the date predicate, ActivityRowList —
// sees rows.
//
// **Every field but `id` is treated as optional**, the same rule the
// intervals.icu mapper follows. A Strava activity still processing, or one
// returned at `resource_state: 1`, is close to a stub.
import { humanizeSportType } from './sportFor.js'

/**
 * Why a row can't be loaded, or null if it can. A **pre-flight guard only** —
 * it exists to grey out rows before a request is made, and it is never the
 * authority. Exactly two reasons, both of which mean "there is no telemetry to
 * fetch", because unlike intervals.icu there is no file type to be wrong about
 * and no second sync source to disclaim.
 */
export function unsupportedReason(activity) {
  // A manual entry is a distance and a duration typed into a form. There is no
  // stream set behind it, and the streams endpoint answers with nothing.
  if (activity.manual === true) {
    return "Entered by hand on Strava — there's no recorded data to chart."
  }
  // `resource_state: 1` is Strava's "meta" representation: an id and little
  // else. It should not appear in a list response, but a row that cannot say
  // what it is must not claim to be loadable.
  if (activity.resource_state === 1) {
    return "This activity's details aren't available."
  }
  return null
}

/**
 * A measurement the API reported, or null. Zero and negative are "didn't say"
 * rather than rendered — same rule, same reason, as the intervals.icu mapper:
 * `0.00 km` on a row reads as a fact the athlete then has to disbelieve.
 */
function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * **Strava's `start_date_local` carries a bogus trailing `Z`.** The value is
 * the athlete's wall clock — `"2018-02-16T14:52:54Z"` for a 14:52 local start
 * — but it is spelled as though it were UTC.
 *
 * `ActivityRow.startedAt` is contractually "no trailing Z, ever", because
 * ActivityRowList's formatter and activityDateRange's `startDayOf` both do a
 * bare `new Date(startedAt)`. Leave the `Z` on and every row west of Greenwich
 * lands on the wrong calendar day — where the date filter, which is on by
 * default, then drops it. The activity simply is not in the list.
 *
 * The real instant is not lost: it is `start_date`, carried separately as
 * `startedAtUtc`.
 */
function stripTrailingZ(value) {
  return typeof value === 'string' ? value.replace(/Z$/, '') : null
}

/**
 * @param {object} activity one raw Strava SummaryActivity
 * @returns {import('../activityRow.js').ActivityRow}
 */
export function toActivityRow(activity) {
  return {
    // **Strava ids are JSON numbers.** ActivityRow.id is a string, `mergeById`
    // keys a Set on it, React keys on it, and it is interpolated into a URL
    // path. Coerced once, here.
    id: String(activity.id),
    // `||`, not `??` — an empty-string name must fall through to the list's
    // placeholder and to a ref with no `name`, so the chart keeps the title
    // deriveWorkoutName inferred rather than being handed a blank one.
    // LOAD-BEARING; the intervals.icu mapper documents the same trap.
    name: activity.name || undefined,
    startedAt: stripTrailingZ(activity.start_date_local),
    // The true instant, and the only reason this field exists on ActivityRow:
    // Strava's `time` stream is *offsets from the start*, so the adapter
    // cannot rebuild absolute timestamps without it, and fetching a
    // DetailedActivity just to learn the start would be a second request per
    // activity opened.
    startedAtUtc: typeof activity.start_date === 'string' ? activity.start_date : null,
    distanceM: positiveNumber(activity.distance),
    // `moving_time` first: it is what an athlete reads as the duration of the
    // session, and it is what Strava itself shows.
    durationS: positiveNumber(activity.moving_time ?? activity.elapsed_time),
    // `sport_type` in preference to the deprecated `type`, which collapses
    // TrailRun and VirtualRun into "Run" — losing exactly the distinction the
    // label is for.
    sportLabel: humanizeSportType(activity.sport_type ?? activity.type),
    unsupportedReason: unsupportedReason(activity),
    // **`device_name` is not available here.** It is a DetailedActivity field,
    // so the intervals.icu mapper's test for Garmin-derived data cannot be
    // used on a Strava *list* row. `external_id` can: Garmin-synced uploads
    // arrive with one like `garmin_push_1234567890`. Strava's API Policy §4.4
    // requires the attribution this drives.
    isGarminDerived:
      typeof activity.external_id === 'string' && activity.external_id.startsWith('garmin'),
  }
}
