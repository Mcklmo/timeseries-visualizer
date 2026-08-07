// Speed in m/s per sample. Prefer the sensor's own reading; only reconstruct
// it from distance/time when the file has none at all, then smooth — a
// derived instantaneous speed from ~1Hz GPS/distance deltas is too noisy to
// chart directly. See ARCHITECTURE.md §8.
import { smooth } from './smooth.js'

const DERIVED_SMOOTH_WINDOW_S = 9 // within the 5-15s band the spec calls for

/**
 * The smoothing window is specified in seconds but `smooth()` counts samples,
 * so it has to be converted at the recording's own cadence — 9 samples is ~9s
 * only at 1 Hz. `| 1` forces an odd width so the window stays centred.
 * @param {number} intervalS
 * @returns {number} window width in samples, odd and >= 1
 */
function smoothWindowSamplesFor(intervalS) {
  return Math.max(1, Math.round(DERIVED_SMOOTH_WINDOW_S / intervalS) | 1)
}

/**
 * @param {object} args
 * @param {{speedMps?: number|null}[]} args.trackpoints
 * @param {number[]} args.t - seconds since start, one per trackpoint
 * @param {number[]} args.d - cumulative metres, one per trackpoint
 * @param {number} [args.intervalS] - the recording's median sample interval; defaults to the historical 1 Hz assumption
 * @returns {(number|null)[]} m/s, one per trackpoint
 */
export function deriveSpeed({ trackpoints, t, d, intervalS = 1 }) {
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

  // At breadcrumb cadences the window collapses to a single sample: a delta
  // measured over 10 minutes is already an average, and there is nothing left
  // to smooth. Branch explicitly rather than relying on smooth(x, 1) being a
  // no-op — it also maps non-finite values to null, which is not a behaviour
  // to inherit by accident.
  const windowSamples = smoothWindowSamplesFor(intervalS)
  if (windowSamples === 1) return instantaneous

  return smooth(instantaneous, windowSamples)
}
