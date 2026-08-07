// Marks samples as paused without deleting them, so elapsed-time axes stay
// gap-aware instead of silently compressing. Two independent triggers, per
// ARCHITECTURE.md §8: a recording gap, or sustained near-zero speed.
const GAP_THRESHOLD_S = 10
const SLOW_SPEED_MPS = 0.3
const SUSTAINED_SLOW_THRESHOLD_S = 10

/**
 * @param {object} args
 * @param {number[]} args.t - seconds since start, one per sample
 * @param {(number|null)[]} args.speed - m/s, one per sample
 * @returns {boolean[]} moving flag, one per sample
 */
export function detectPauses({ t, speed }) {
  const n = t.length
  const moving = new Array(n).fill(true)

  // A recording gap longer than the threshold means the device stopped
  // logging during a pause; the sample right after the gap is where it
  // resumed, so it's marked as the pause boundary.
  for (let i = 1; i < n; i++) {
    if (t[i] - t[i - 1] > GAP_THRESHOLD_S) moving[i] = false
  }

  // A stretch of near-zero speed lasting more than the threshold is a real
  // stop (traffic light, etc.), even though the device kept recording.
  let runStart = null
  const closeRun = (runEnd) => {
    if (runStart !== null && t[runEnd] - t[runStart] > SUSTAINED_SLOW_THRESHOLD_S) {
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
