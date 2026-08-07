// The pipeline entry point: RawTrackpoint[] -> Activity. See ARCHITECTURE.md
// §3 layer diagram (normalizeActivity -> derive* -> Activity) and §8 for the
// TCX-specific edge cases this exists to absorb, so every ActivitySource
// adapter can stay a dumb field-mapper.
import { buildDistanceAxis } from './buildDistanceAxis.js'
import { deriveSpeed } from './deriveSpeed.js'
import { deriveWorkoutName } from './deriveWorkoutName.js'
import { detectPauses } from './detectPauses.js'
import { medianIntervalOf } from './samplingInterval.js'

// A trackpoint with only a timestamp and nothing else carries no signal —
// drop it here rather than let it become a sample full of nulls. "Nothing
// else" is judged on the raw fields an adapter could have filled in.
function hasAnyData(tp) {
  return (
    tp.distanceMeters != null ||
    tp.altitudeMeters != null ||
    tp.heartRateBpm != null ||
    tp.cadenceSpm != null ||
    tp.watts != null ||
    tp.speedMps != null ||
    (tp.lat != null && tp.lon != null)
  )
}

/** Duration (s) each sample represents: the gap to the next sample, 0 for the last. */
function movingTimeOf(samples) {
  let sum = 0
  for (let i = 0; i < samples.length - 1; i++) {
    if (samples[i].moving) sum += samples[i + 1].t - samples[i].t
  }
  return sum
}

/** @param {import('./types.js').Sample[]} samples @returns {import('./types.js').MetricId[]} */
function availableMetricsOf(samples) {
  const ids = []
  if (samples.some((s) => s.speed != null)) {
    ids.push('pace')
    ids.push('speed')
  }
  if (samples.some((s) => s.heartRate != null)) ids.push('heartRate')
  if (samples.some((s) => s.power != null)) ids.push('power')
  if (samples.some((s) => s.cadence != null)) ids.push('cadence')
  if (samples.some((s) => s.altitude != null)) ids.push('altitude')
  return ids
}

/**
 * @param {object} args
 * @param {string} args.id
 * @param {import('./types.js').Sport} args.sport
 * @param {string} [args.sportLabel] - watch sport-profile name, FIT only (e.g. "Trail Run")
 * @param {import('./types.js').RawTrackpoint[]} args.trackpoints
 * @returns {import('./types.js').Activity}
 */
export function normalizeActivity({ id, sport, sportLabel, trackpoints }) {
  const usable = trackpoints.filter(hasAnyData)
  const startTime = usable.length > 0 ? usable[0].time : new Date()

  const t = usable.map((tp) => (tp.time.getTime() - startTime.getTime()) / 1000)
  // Every threshold below this line scales off the recording's own cadence
  // rather than assuming ~1 Hz — see samplingInterval.js. A GPS breadcrumb
  // logged every 10 minutes is not a 10-minute pause.
  const intervalS = medianIntervalOf(t)
  const d = buildDistanceAxis(usable)
  const speed = deriveSpeed({ trackpoints: usable, t, d, intervalS })
  const moving = detectPauses({ t, speed, intervalS })

  const samples = usable.map((tp, i) => ({
    t: t[i],
    d: d[i],
    speed: speed[i] ?? undefined,
    heartRate: tp.heartRateBpm ?? undefined,
    cadence: tp.cadenceSpm ?? undefined,
    power: tp.watts ?? undefined,
    altitude: tp.altitudeMeters ?? undefined,
    moving: moving[i],
  }))

  // Computed before the name, not inline below it: a recording spanning days
  // is named by its duration rather than by a time-of-day bucket.
  const totalTime = samples.length > 0 ? samples[samples.length - 1].t : 0

  return {
    id,
    sport,
    name: deriveWorkoutName({ sport, sportLabel, startTime, totalTime }),
    startTime,
    totalTime,
    totalMovingTime: movingTimeOf(samples),
    totalDistance: samples.length > 0 ? samples[samples.length - 1].d : 0,
    samples,
    samplingIntervalS: intervalS,
    availableMetrics: availableMetricsOf(samples),
  }
}
