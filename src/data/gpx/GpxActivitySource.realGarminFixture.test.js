// The same activity as the TCX and FIT cross-checks, exported as GPX —
// i.e. reduced to what GPX actually carries (lat/lon/ele/time), generated
// once from fixtures/activity_23870166877.tcx and committed.
//
// This is the first real-data exercise of two code paths that existed but
// had only ever been unit-tested: buildDistanceAxis' haversine fallback (no
// <DistanceMeters> anywhere) and deriveSpeed's derived path (no sensor speed
// anywhere). Quantifying how far they drift from Garmin's own figures is the
// point of the file — hence the deliberately looser distance tolerance than
// the TCX test's 10 m.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { metricRegistry } from '../../metrics/metricRegistry.js'
import { computeMetricStat } from '../../stats/aggregate.js'
import { GpxActivitySource } from './GpxActivitySource.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const gpxXml = readFileSync(join(FIXTURE_DIR, 'activity_23870166877.gpx'), 'utf-8')
const meta = JSON.parse(readFileSync(join(FIXTURE_DIR, 'activity_23870166877-meta.json'), 'utf-8'))

const DISTANCE_TOLERANCE = 0.03 // haversine over noisy 1 Hz fixes overestimates; see below

async function loadFixtureActivity() {
  const file = new File([gpxXml], 'activity_23870166877.gpx', { type: 'application/gpx+xml' })
  return new GpxActivitySource().load({ type: 'file', file })
}

describe('real Garmin export as GPX (fixtures/activity_23870166877.gpx)', () => {
  it('parses the full trackpoint history and reads the sport from <trk><type>', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.samples.length).toBeGreaterThan(1000)
    expect(activity.sport).toBe('running')
  })

  it('recognises this as a ~1 Hz recording, so every threshold stays at its pre-adaptive value', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.samplingIntervalS).toBe(1)
  })

  it('total time matches the reported duration, within 1 second', async () => {
    const activity = await loadFixtureActivity()
    expect(Math.abs(activity.totalTime - meta.actual_duration_min * 60)).toBeLessThan(1)
  })

  it('reconstructs distance from lat/lon within 3% of Garmin\'s own figure', async () => {
    const activity = await loadFixtureActivity()
    const expectedMetres = meta.actual_distance_km * 1000
    const drift = (activity.totalDistance - expectedMetres) / expectedMetres

    expect(Math.abs(drift)).toBeLessThan(DISTANCE_TOLERANCE)
    // Summing great-circle hops between noisy per-second fixes accumulates the
    // noise as extra distance, so the drift is expected to be *positive* —
    // pinned here so a future change that quietly loses distance is visible.
    expect(drift).toBeGreaterThan(0)
  })

  it('derives an average pace close to what Garmin reported, given that inflated distance', async () => {
    const activity = await loadFixtureActivity()

    const avgPaceSecPerKm = computeMetricStat({
      samples: activity.samples,
      metric: metricRegistry.pace,
      statKind: 'avg',
      totalMovingTime: activity.totalMovingTime,
      totalDistance: activity.totalDistance,
    })

    const expectedSecPerKm = meta.actual_avg_pace_min * 60 + meta.actual_avg_pace_sec
    // Pace is distance-derived, so it inherits the distance drift and nothing
    // more: a few % of 382 s/km, i.e. seconds, not the 0:02/km the sparse-data
    // bug used to produce.
    expect(Math.abs(avgPaceSecPerKm - expectedSecPerKm)).toBeLessThan(expectedSecPerKm * DISTANCE_TOLERANCE)
  })

  it('offers only the channels GPX carries — no heart rate, cadence or power', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.availableMetrics).toEqual(['pace', 'speed', 'altitude'])
  })

  it('agrees with the TCX export of the same run that nothing was paused', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.samples.every((s) => s.moving)).toBe(true)
  })
})
