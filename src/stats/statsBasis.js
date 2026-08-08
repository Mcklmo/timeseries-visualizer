// What the stat aggregators run on: the samples in view, plus the totals those
// aggregators need but cannot derive from samples alone. See ARCHITECTURE.md
// §6 — stats follow the zoom window.
//
// This file exists because of one trap. `computeMetricStat` reads
// `totalMovingTime`/`totalDistance` for the `weightedPace` average (average
// pace is total time ÷ total distance, never the mean of instantaneous paces),
// and those two arrive as arguments, not from the samples. Slice `samples`
// alone and every other stat windows correctly while average pace keeps
// reporting the whole activity's — a wrong number that still looks entirely
// plausible, which is the worst kind. The window's totals are recomputed here
// so the two can't drift apart.
//
// stats/aggregate.js stays free of any notion of zoom: it already takes
// samples + totals as arguments, so a window is just a different argument.
//
// Known consequence, measured rather than assumed: avg pace is derived from
// the DISTANCE axis while max/min/median come from the sensor SPEED field, and
// those two agree over a whole activity but not over a few seconds of it. On
// the real Garmin fixture, avg lands outside the window's own fastest/slowest
// instantaneous pace in 42 of 99 windows at the 50x zoom cap (worst 16.8 s/km,
// ~4%), never below 10x. It is not a windowing defect and must not be "fixed"
// by integrating speed for the window's distance: matching Garmin's own
// average pace is the point of weightedPace (§6), and that match comes from
// the distance axis.

import { totalMovingTimeOf } from '../domain/sampleDurations.js'
import { gapThresholdFor } from '../domain/samplingInterval.js'
import { sliceSamplesByX } from '../domain/sliceSamples.js'
import { isFullDomain, resolveDomain } from '../domain/zoomDomain.js'

/**
 * @typedef {object} StatsBasis
 * @property {import('../domain/types.js').Sample[]} samples
 * @property {number} totalMovingTime - s, over `samples` only
 * @property {number} totalDistance - m, over `samples` only
 * @property {number} elapsedTime - s, wall clock over `samples` only — what the header reports
 * @property {number|undefined} gapThresholdS
 */

/**
 * @param {import('../domain/types.js').Activity|null|undefined} activity
 * @param {'t'|'d'} xKey - which axis `zoomDomain` is expressed in
 * @param {unknown} zoomDomain - sentinel or numeric pair (domain/zoomDomain.js)
 * @param {[number, number]|null} fullExtent - the activity's x-extent
 * @returns {StatsBasis|null} null when there is no activity to report on
 */
export function statsBasisFor(activity, xKey, zoomDomain, fullExtent) {
  if (!activity) return null

  // Guarded, not defensive styling: gapThresholdFor(undefined) is 10, not
  // Infinity, so an activity with no measured cadence would have every
  // interval read as a gap and every weight zeroed.
  const gapThresholdS =
    activity.samplingIntervalS != null ? gapThresholdFor(activity.samplingIntervalS) : undefined

  // Unzoomed returns the activity's own arrays and totals BY REFERENCE, so the
  // unzoomed render stays byte-identical to what it was before stats followed
  // zoom — the same "conditional, not unconditional" rule `allowDataOverflow`
  // follows. A null fullExtent (nothing plottable) has no window to resolve
  // against and takes the same path.
  if (isFullDomain(zoomDomain) || !fullExtent) {
    return {
      samples: activity.samples,
      totalMovingTime: activity.totalMovingTime,
      totalDistance: activity.totalDistance,
      // ?? 0 upholds this file's "no NaN reaches the DOM" guarantee rather
      // than guarding against the Activity contract: totalTime is required
      // (domain/types.js) and always set by normalizeActivity, but plenty of
      // hand-built test fixtures omit it.
      elapsedTime: activity.totalTime ?? 0,
      gapThresholdS,
    }
  }

  const samples = sliceSamplesByX(activity.samples, xKey, resolveDomain(zoomDomain, fullExtent))
  if (samples.length === 0) {
    // Every aggregator answers null on an empty series, and computeMetricStat
    // rejects a non-positive totalDistance, so the chips simply disappear —
    // no NaN reaches the DOM.
    return { samples, totalMovingTime: 0, totalDistance: 0, elapsedTime: 0, gapThresholdS }
  }

  return {
    samples,
    // sampleDurations' last-sample-weighs-0 rule needs no correction over a
    // slice, and must not be "fixed": the durations sum to t[last] - t[first],
    // which is exactly the window's span. Distance and elapsed time are
    // measured the same way — first-to-last, not cumulative-from-zero — so all
    // three describe the same interval and cannot drift apart.
    totalMovingTime: totalMovingTimeOf(samples, gapThresholdS),
    totalDistance: samples[samples.length - 1].d - samples[0].d,
    // Elapsed, deliberately NOT totalMovingTime: this is the number the header
    // prints beside the charts, and the pauses it includes are inside the span
    // the x-axis draws. Moving time would put a duration in the header that
    // disagrees with the picture next to it. Measured in `t` whichever axis is
    // showing, so a distance window still reports a time.
    elapsedTime: samples[samples.length - 1].t - samples[0].t,
    gapThresholdS,
  }
}
