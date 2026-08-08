// Centred rolling mean, and the seconds→samples conversion that sizes its
// window. Used by deriveSpeed.js to tame derived-speed noise before it reaches
// the pace chart (ARCHITECTURE.md §8) and by derivative.js for the same reason
// one order up.

const DERIVED_SMOOTH_WINDOW_S = 9 // within the 5-15s band the spec calls for

/**
 * The smoothing window is specified in seconds but `smooth()` counts samples,
 * so it has to be converted at the recording's own cadence — 9 samples is ~9s
 * only at 1 Hz. `| 1` forces an odd width so the window stays centred.
 *
 * Lives here rather than in deriveSpeed.js, which is where it started, because
 * derivative.js needs the identical window: a derived speed and a displayed
 * d/dt are the same measurement problem, and two copies of the constant would
 * be free to drift apart.
 *
 * @param {number} intervalS
 * @returns {number} window width in samples, odd and >= 1
 */
export function smoothWindowSamplesFor(intervalS) {
  return Math.max(1, Math.round(DERIVED_SMOOTH_WINDOW_S / intervalS) | 1)
}

/**
 * @param {(number|null|undefined)[]} values
 * @param {number} windowSamples - total window width, in samples (not seconds)
 * @returns {(number|null)[]} same length as `values`; null where the window has no data
 */
export function smooth(values, windowSamples) {
  const half = Math.floor(windowSamples / 2)
  return values.map((_, i) => {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const v = values[j]
      if (v == null || !Number.isFinite(v)) continue
      sum += v
      count++
    }
    return count === 0 ? null : sum / count
  })
}
