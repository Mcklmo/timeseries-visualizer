// The pipeline entry point: RawTrackpoint[] -> Activity. See ARCHITECTURE.md
// §3 layer diagram (normalizeActivity -> derive* -> Activity) and §8 for the
// TCX-specific edge cases this exists to absorb, so every ActivitySource
// adapter can stay a dumb field-mapper.
import { activityKeyOf } from './activityKey.js'
import { buildDistanceAxis } from './buildDistanceAxis.js'
import { buildTrack } from './buildTrack.js'
import { deriveSpeed } from './deriveSpeed.js'
import { deriveWorkoutName } from './deriveWorkoutName.js'
import { detectPauses } from './detectPauses.js'
import { totalMovingTimeOf } from './sampleDurations.js'
import { gapThresholdFor, medianIntervalOf } from './samplingInterval.js'

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
 * @param {import('./types.js').Sport} args.sport
 * @param {string} [args.sportLabel] - watch sport-profile name, FIT only (e.g. "Trail Run")
 * @param {import('./types.js').RawTrackpoint[]} args.trackpoints
 * @returns {import('./types.js').Activity}
 */
export function normalizeActivity({ sport, sportLabel, trackpoints }) {
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

  // Built from `usable` — the SAME array, in the same order, as the samples
  // above — which is what makes `track.x[i]` and `samples[i]` the same instant.
  // That invariant is by construction and nothing enforces it: keep these two
  // adjacent, and if either ever stops mapping over `usable`, the map's
  // crosshair silently points at the wrong place. Null for a treadmill run.
  const track = buildTrack(usable)

  // Computed before the name, not inline below it: a recording spanning days
  // is named by its duration rather than by a time-of-day bucket.
  const totalTime = samples.length > 0 ? samples[samples.length - 1].t : 0

  // Locals rather than inlined into the object below, because the identity is
  // a fingerprint *of* them (activityKey.js) — no adapter supplies an id any
  // more, and the ones they used to supply were unusable as identity.
  const totalDistance = samples.length > 0 ? samples[samples.length - 1].d : 0
  // ⚠️ THE MAP HAS NO ENTRY HERE, AND MUST NOT GET ONE. `availableMetrics` is
  // hashed into the activity's identity (activityKey.js hashes
  // `availableMetrics.join(',')`), so adding 'map' would change every existing
  // Activity.id and silently fork every remembered view in sessionStorage. It
  // would also reach `metricRegistry['map'].label` in StatCheckboxes via a
  // restored `enabledMetrics` and throw. The map's availability gate is
  // `activity.track != null`, and nothing else.
  const availableMetrics = availableMetricsOf(samples)

  return {
    // An activity with no usable trackpoints falls back to `new Date()` above,
    // so its key is non-deterministic. Left alone: it renders no charts, so
    // there is no remembered view for the key to fail to find.
    id: activityKeyOf({ sport, startTime, totalTime, totalDistance, samples, availableMetrics }),
    sport,
    name: deriveWorkoutName({ sport, sportLabel, startTime, totalTime }),
    startTime,
    totalTime,
    totalMovingTime: totalMovingTimeOf(samples, gapThresholdFor(intervalS)),
    totalDistance,
    samples,
    samplingIntervalS: intervalS,
    availableMetrics,
    track,
  }
}
