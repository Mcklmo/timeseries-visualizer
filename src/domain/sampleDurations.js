// How long each sample "counts for" — the one place that turns a list of
// samples into the weights every time-weighted stat runs on. Both
// normalizeActivity and stats/aggregate held their own copy of this loop, and
// that duplication is exactly why one defect (pause duration landing in
// totalMovingTime) lived in two files at once.
//
// Attribution is a left-end zero-order hold: sample `i`'s reading is taken to
// hold across the interval forward to `i+1`, so the interval's seconds are
// credited to `i`. The last sample has no forward interval and weighs 0.
//
// An interval only counts when it is REAL — the device was still logging
// across it (dt <= gapThresholdS). Time inside a recording gap is time we know
// nothing about, and holding the last reading across it lets a single campsite
// altitude sample outweigh a whole day of walking.
//
// Under `movingOnly` it must additionally have been TRAVELLED, and that needs
// *both* ends stopped, not either. detectPauses flags the sample that RESUMES
// after a gap rather than the one before it (see detectPauses.js), so a strict
// "either end stopped" rule would also discard the first real interval after
// every pause — 6s on a 1 Hz watch file, but 40 minutes on a 10-minute
// breadcrumb log. One stopped end is a boundary (decelerating into a traffic
// light, or the first breadcrumb after a dropout) and stays counted.
//
// `gapThresholdS` defaults to Infinity so a caller with no measured cadence
// counts every interval, as this code always did. Do NOT reach for
// gapThresholdFor() to build that default — it returns 10 for an undefined
// interval, which would read every interval of a sparse log as a gap and zero
// every weight.

/**
 * @param {import('./types.js').Sample[]} samples
 * @param {object} [opts]
 * @param {number} [opts.gapThresholdS] - a t delta above this is a recording gap; default counts every interval
 * @param {boolean} [opts.movingOnly] - additionally drop intervals stopped at both ends
 * @returns {number[]} seconds, one per sample; 0 where the interval does not count
 */
export function sampleDurations(samples, { gapThresholdS = Infinity, movingOnly = false } = {}) {
  return samples.map((s, i) => {
    const next = samples[i + 1]
    if (next === undefined) return 0 // last sample has no forward interval
    const dt = next.t - s.t
    // Also subsumes the old Math.max(0, …) guard: duplicate or out-of-order
    // timestamps carry no duration.
    if (!(dt > 0) || dt > gapThresholdS) return 0
    if (movingOnly && s.moving === false && next.moving === false) return 0
    return dt
  })
}

/** Total seconds actually travelled: the moving intervals, summed. */
export function totalMovingTimeOf(samples, gapThresholdS) {
  return sampleDurations(samples, { gapThresholdS, movingOnly: true }).reduce((a, b) => a + b, 0)
}
