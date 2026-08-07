// Centred rolling mean. Used by deriveSpeed.js to tame derived-speed noise
// before it reaches the pace chart — see ARCHITECTURE.md §8.

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
