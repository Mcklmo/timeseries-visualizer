// Aggregation strategies for reference-line stats. See ARCHITECTURE.md §6.
//
// The one rule that matters most: average pace is never the mean of
// instantaneous pace samples. By the AM-HM inequality that mean is always
// slower than reality whenever speed varies, and it will visibly disagree
// with Garmin/Strava/every other app for the same file. Average pace is
// always totalMovingTime / totalDistance.

/** Duration (s) each sample represents: the gap to the next sample, 0 for the last. */
function sampleDurations(samples) {
  return samples.map((s, i) => (i === samples.length - 1 ? 0 : Math.max(0, samples[i + 1].t - s.t)))
}

function timeWeightedMean(samples, accessor, { movingOnly = false } = {}) {
  const durations = sampleDurations(samples)
  let weightedSum = 0
  let totalWeight = 0
  samples.forEach((s, i) => {
    if (movingOnly && s.moving === false) return
    const value = accessor(s)
    if (value == null || !Number.isFinite(value)) return
    const w = durations[i]
    weightedSum += value * w
    totalWeight += w
  })
  if (totalWeight === 0) return null
  return weightedSum / totalWeight
}

function median(samples, accessor) {
  const values = samples
    .filter((s) => s.moving !== false)
    .map(accessor)
    .filter((v) => v != null && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (values.length === 0) return null
  const mid = Math.floor(values.length / 2)
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid]
}

// "Max" is the extreme value in the direction that reads as the peak on the
// metric's own (possibly reversed) axis — for invertAxis metrics like pace,
// where faster reads higher, that is the numeric MINIMUM (fastest moment),
// not the largest s/km. "Min" is max's mirror image: the extreme that reads
// as the trough (worst moment) — numeric MAXIMUM for invertAxis metrics.
// avg and median are not direction-aware.
function extreme(samples, accessor, { movingOnly = false, invert = false } = {}) {
  let best = null
  for (const s of samples) {
    if (movingOnly && s.moving === false) continue
    const v = accessor(s)
    if (v == null || !Number.isFinite(v)) continue
    if (best === null || (invert ? v < best : v > best)) best = v
  }
  return best
}

/**
 * Y-axis domain for a metric's chart panel, computed from the real data
 * range rather than left to Recharts' auto-domain — opt-in per metric via
 * `metric.domainPadding` (see metricRegistry.js). Applies the same
 * `movingOnly` exclusion as `extreme()`/`timeWeightedMean()` above, so
 * paused samples (e.g. cadence reading 0 while stopped) don't drag the
 * range down to 0. Returns undefined for metrics that don't opt in, so
 * `<YAxis domain={...}>` falls through to Recharts' current behavior.
 * @param {object} args
 * @param {import('../domain/types.js').Sample[]} args.samples
 * @param {{accessor: (s: import('../domain/types.js').Sample) => number|null, aggStrategy?: string, domainPadding?: number}} args.metric
 * @returns {[number, number]|undefined}
 */
export function computeYDomain({ samples, metric }) {
  if (metric.domainPadding == null) return undefined
  const { accessor, aggStrategy, domainPadding } = metric
  let min = null
  let max = null
  for (const s of samples) {
    if (aggStrategy === 'movingOnly' && s.moving === false) continue
    const v = accessor(s)
    if (v == null || !Number.isFinite(v)) continue
    if (min === null || v < min) min = v
    if (max === null || v > max) max = v
  }
  if (min === null) return undefined
  const pad = (max - min) * domainPadding || 1
  return [Math.max(0, min - pad), max + pad]
}

/**
 * @param {object} args
 * @param {import('../domain/types.js').Sample[]} args.samples
 * @param {{accessor: (s: import('../domain/types.js').Sample) => number|null, aggStrategy: 'timeWeighted'|'movingOnly'|'weightedPace', invertAxis?: boolean}} args.metric
 * @param {'max'|'min'|'avg'|'median'} args.statKind
 * @param {number} args.totalMovingTime - s, whole-activity total (weightedPace avg only)
 * @param {number} args.totalDistance - m, whole-activity total (weightedPace avg only)
 * @returns {number|null}
 */
export function computeMetricStat({ samples, metric, statKind, totalMovingTime, totalDistance }) {
  const { accessor, aggStrategy, invertAxis } = metric

  if (statKind === 'median') return median(samples, accessor)
  if (statKind === 'max')
    return extreme(samples, accessor, { movingOnly: aggStrategy === 'movingOnly', invert: !!invertAxis })
  if (statKind === 'min')
    return extreme(samples, accessor, { movingOnly: aggStrategy === 'movingOnly', invert: !invertAxis })

  // avg
  if (aggStrategy === 'weightedPace') {
    if (!(totalDistance > 0)) return null
    return (totalMovingTime / totalDistance) * 1000 // s per km, matching the pace accessor's units
  }
  if (aggStrategy === 'movingOnly') return timeWeightedMean(samples, accessor, { movingOnly: true })
  return timeWeightedMean(samples, accessor)
}
