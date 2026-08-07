// The recording's own cadence, and the thresholds that scale off it. The
// pipeline used to assume ~1 Hz logging of at most a few hours (the shape
// every TCX/FIT export from a watch has); a satellite messenger or camera GPX
// logs a breadcrumb every 2.5-30 minutes across days, and every fixed-seconds
// constant downstream reads that as one continuous pause. See ARCHITECTURE.md
// §8 (GPX).

// The pre-adaptive constant. Anything at or above 1 Hz keeps it exactly, which
// is what makes this change a no-op for watch files.
const MIN_GAP_THRESHOLD_S = 10
// A gap has to be several missed samples, not one late one, before it counts
// as a real dropout rather than ordinary jitter.
const GAP_INTERVAL_MULTIPLE = 4

/**
 * Median rather than mean: a single multi-hour satellite dropout must not drag
 * a 10-minute breadcrumb log's idea of "typical" up with it.
 * @param {number[]} t - seconds since start, one per sample
 * @returns {number} median gap between consecutive samples; 1 when undeterminable
 */
export function medianIntervalOf(t) {
  const deltas = []
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i - 1]
    // Duplicate or out-of-order timestamps carry no cadence signal.
    if (dt > 0) deltas.push(dt)
  }
  if (deltas.length === 0) return 1
  deltas.sort((a, b) => a - b)
  const mid = Math.floor(deltas.length / 2)
  return deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid]
}

/**
 * Exported rather than inlined into detectPauses because the UI's gap-break
 * insertion (domain/insertGapBreaks.js) has to agree with pause detection on
 * where a gap is, or the line would break somewhere the stats don't.
 * @param {number} intervalS - the recording's median sample interval
 * @returns {number} seconds; a t delta above this is a recording gap
 */
export function gapThresholdFor(intervalS) {
  if (!(intervalS > 0)) return MIN_GAP_THRESHOLD_S
  return Math.max(MIN_GAP_THRESHOLD_S, GAP_INTERVAL_MULTIPLE * intervalS)
}
