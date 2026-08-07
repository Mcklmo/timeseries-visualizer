// Marks samples as paused without deleting them, so elapsed-time axes stay
// gap-aware instead of silently compressing. Two independent triggers, per
// ARCHITECTURE.md §8: a recording gap, or sustained near-zero speed.
import { gapThresholdFor } from './samplingInterval.js'

// A physical threshold, not a sampling one — stays fixed at every cadence.
const SLOW_SPEED_MPS = 0.3

/**
 * @param {object} args
 * @param {number[]} args.t - seconds since start, one per sample
 * @param {(number|null)[]} args.speed - m/s, one per sample
 * @param {number} [args.intervalS] - the recording's median sample interval; defaults to the historical 1 Hz assumption
 * @returns {boolean[]} moving flag, one per sample
 */
export function detectPauses({ t, speed, intervalS = 1 }) {
  const n = t.length
  const moving = new Array(n).fill(true)

  // Both triggers were fixed 10s constants back when a ~1 Hz recording was the
  // only shape supported, and both scale off the sampling interval the same
  // way — so one threshold serves both. gapThresholdFor(1) is still exactly
  // 10, so watch files behave identically; a device logging every 10 minutes
  // gets 40 minutes, so ordinary breadcrumbs stay "moving" and only a real
  // satellite dropout counts as a pause.
  const thresholdS = gapThresholdFor(intervalS)

  // A recording gap longer than the threshold means the device stopped
  // logging during a pause; the sample right after the gap is where it
  // resumed, so it's marked as the pause boundary.
  for (let i = 1; i < n; i++) {
    if (t[i] - t[i - 1] > thresholdS) moving[i] = false
  }

  // A stretch of near-zero speed lasting more than the threshold is a real
  // stop (traffic light, etc.), even though the device kept recording.
  let runStart = null
  const closeRun = (runEnd) => {
    if (runStart !== null && t[runEnd] - t[runStart] > thresholdS) {
      for (let j = runStart; j <= runEnd; j++) moving[j] = false
    }
    runStart = null
  }
  for (let i = 0; i < n; i++) {
    const isSlow = speed[i] != null && speed[i] < SLOW_SPEED_MPS
    if (isSlow) {
      if (runStart === null) runStart = i
    } else {
      closeRun(i - 1)
    }
  }
  closeRun(n - 1)

  return moving
}
