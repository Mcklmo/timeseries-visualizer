// Real ActivitySource adapter: {type:'id', provider:'strava'} -> Strava's
// streams -> RawTrackpoint[] -> normalizeActivity. See ARCHITECTURE.md §5 —
// this is the DI boundary; no component imports this class, only
// data/sourceRegistry.js does.
//
// **There is no new parser here, and that is the whole point — but for a
// different reason than IntervalsActivitySource's.** That adapter reuses
// parseFit/parseTcx/parseGpx byte for byte, because intervals.icu hands back
// the athlete's *original file*. Strava has no original-file endpoint at all;
// streams are the only telemetry route. What makes this cheap anyway is that
// the real port on the domain side is **`RawTrackpoint[]`, not `File`** —
// normalizeActivity has never seen a file — so assembling parallel arrays
// satisfies the same contract, and every derivation below it (distance axis,
// speed, pause detection, sampling interval, available metrics) is shared
// unchanged with the three file parsers.
//
// **What this path cannot promise, stated plainly:** Strava resamples, applies
// its own elevation correction, and ships a pre-smoothed `velocity_smooth`
// that overrides this app's own speed derivation (see streamsToTrackpoints.js).
// So a Strava-loaded activity will *not* be numerically identical to the same
// activity's FIT file loaded from disk. The realGarminFixture cross-check
// asserts a tolerance rather than equality, and that tolerance is the honest
// statement of how far apart the two are.
//
// StravaApiError propagates untouched. That satisfies the port contract
// (ErrorState renders `error.message` verbatim) *and* lets the picker, the only
// caller that can do anything smarter, switch on `.code`.
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { StravaApiError, fetchStreams } from './stravaApi.js'
import { humanizeSportType, sportFor } from './sportFor.js'
import { createStreamCache } from './streamCache.js'
import { streamsToTrackpoints } from './streamsToTrackpoints.js'

/** @implements {import('../ActivitySource.js').ActivitySource} */
export class StravaActivitySource {
  kind = 'strava'

  /**
   * `getAccessToken` is an **async** function, unlike intervals.icu's
   * `getApiKey`: a Strava access token expires in six hours, so reading it is
   * a step that may have to refresh first (see stravaApi.js's
   * `readFreshAccessToken`). Reading it at call time rather than capturing it
   * is the same rule for the same reason — a Disconnect, or a token cleared in
   * another tab, takes effect on the very next load.
   *
   * @param {{getAccessToken: () => Promise<string>, fetchImpl?: typeof fetch,
   *          cache?: ReturnType<typeof createStreamCache>}} options
   */
  constructor({ getAccessToken, fetchImpl, cache = createStreamCache() } = {}) {
    this.getAccessToken = getAccessToken ?? (async () => null)
    this.fetchImpl = fetchImpl
    // The cache sits *inside* load, not around it, so ErrorState's "Try again"
    // and a back-then-reopen both get it for free without any caller knowing
    // it exists.
    this.cache = cache
  }

  /**
   * @param {import('../ActivitySource.js').ActivityRef} ref
   * @returns {Promise<import('../../domain/types.js').Activity>}
   */
  async load(ref) {
    if (ref.type !== 'id') {
      throw new Error('StravaActivitySource can only load an id reference')
    }

    // **The start instant rides in on the ref** rather than costing a second
    // API request per activity opened. Strava's `time` stream is offsets in
    // seconds from the start, so without this there is nothing to add them to.
    // `startedAtUtc` is `start_date` — the real UTC instant. Deliberately NOT
    // `start_date_local`, which carries a bogus trailing `Z` on what is
    // actually wall clock (see toActivityRow.js).
    const startTime = new Date(ref.startedAtUtc ?? NaN)
    if (Number.isNaN(startTime.getTime())) {
      throw new StravaApiError('unexpected', "This activity is missing its start time, so its data can't be placed on a timeline.")
    }

    const accessToken = await this.getAccessToken()
    if (!accessToken) {
      // Reported as `not_connected`, which the picker handles by dropping back
      // to the connect view — the right recovery for a token that went missing
      // mid-session.
      throw new StravaApiError('not_connected')
    }

    let streams = this.cache.get(ref.id)
    if (!streams) {
      streams = await fetchStreams({ accessToken, activityId: ref.id, fetchImpl: this.fetchImpl })
      // Cached only after a successful fetch, and streams are immutable, so
      // there is no TTL and nothing to invalidate. See streamCache.js.
      this.cache.set(ref.id, streams)
    }

    // **Resolved before assembly, not after.** Cadence doubling for foot
    // sports depends on it, and getting that ordering wrong is the failure
    // that charts every run at half its real cadence without throwing.
    const sport = sportFor(ref.sportType)

    const activity = normalizeActivity({
      sport,
      // The humanized sport type, NOT the activity's title. deriveWorkoutName
      // prefixes a time-of-day bucket to whatever this says, so a real title
      // here would produce "Morning Tempo 5×1k".
      sportLabel: humanizeSportType(ref.sportType) ?? undefined,
      trackpoints: streamsToTrackpoints({ streams, startTime, sport }),
    })

    // The real title wins over the inferred one, applied *after* normalize and
    // therefore outside the content fingerprint that is the activity's id —
    // the same seam IntervalsActivitySource uses, for the same reason. It
    // often won't be there (an untitled activity), so the derived name stays a
    // live fallback rather than dead code.
    return ref.name ? { ...activity, name: ref.name } : activity
  }

  /**
   * **No, and this is a decision rather than an omission.**
   *
   * As the class header says: *Strava has no original-file endpoint at all;
   * streams are the only telemetry route.* Exporting a window would therefore
   * mean SYNTHESIZING a file out of `Activity.samples`, which this codebase has
   * already ruled against (trimFit.js:109-121, and ARCHITECTURE.md §3's
   * dependency rule). It would require inverting, per sport and per source
   * format, every derivation the read path applies — cadence doubling, speed
   * derivation and its 9 s smoothing, the distance axis's monotonic clamp and
   * haversine substitution, the Web Mercator projection whose inverse
   * webMercator.js does not have — and `Sample` carries no marker
   * distinguishing a recorded value from a derived one, so there is no honest
   * way to write back only what the device actually measured.
   *
   * Written out explicitly, rather than left absent, because an omission is
   * indistinguishable from "not implemented yet". This is what moves the
   * exclusion out of the UI and into the adapter that knows why.
   */
  canExportWindow() {
    return false
  }

  /**
   * Unreachable through the button, which asks `canExportWindow` first. Present
   * so that a future caller reaching past the gate gets the reason rather than
   * an `undefined is not a function`.
   *
   * A plain Error, not a StravaApiError: nothing was requested and Strava said
   * nothing. There is no `.code` for the picker to switch on, and inventing one
   * would put a value in StravaErrorCode that no response can ever produce.
   */
  async readOriginalBytes() {
    throw new Error("Strava doesn't provide the original file for an activity, so a zoom window can't be exported from it")
  }
}
