// Speed in m/s per sample. Prefer the sensor's own reading; only reconstruct
// it from distance/time when the file has none at all, then smooth — a
// derived instantaneous speed from ~1Hz GPS/distance deltas is too noisy to
// chart directly. See ARCHITECTURE.md §8.
import { smooth } from './smooth.js'

const DERIVED_SMOOTH_WINDOW_SAMPLES = 9 // ~9s at typical 1Hz TCX sampling, within the 5-15s band the spec calls for

/**
 * @param {object} args
 * @param {{speedMps?: number|null}[]} args.trackpoints
 * @param {number[]} args.t - seconds since start, one per trackpoint
 * @param {number[]} args.d - cumulative metres, one per trackpoint
 * @returns {(number|null)[]} m/s, one per trackpoint
 */
export function deriveSpeed({ trackpoints, t, d }) {
  const hasAnySensorSpeed = trackpoints.some((tp) => tp.speedMps != null)
  if (hasAnySensorSpeed) {
    return trackpoints.map((tp) => tp.speedMps ?? null)
  }

  const instantaneous = t.map((ti, i) => {
    if (i === 0) return null
    const dt = ti - t[i - 1]
    if (!(dt > 0)) return null
    return (d[i] - d[i - 1]) / dt
  })
  // First sample has no preceding interval; carry the second sample's value
  // back so the pace chart doesn't start with a hard null.
  if (instantaneous.length > 1) instantaneous[0] = instantaneous[1]

  return smooth(instantaneous, DERIVED_SMOOTH_WINDOW_SAMPLES)
}
