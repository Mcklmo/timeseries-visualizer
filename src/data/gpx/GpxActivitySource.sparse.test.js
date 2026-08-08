// End-to-end against the shape this feature exists for: a satellite
// messenger's log (SPOT X, or an OM Tough TG-7 track converted by OI.Track).
// Position + elevation + time only, a breadcrumb every 10 minutes, three days
// long, with one 6-hour dropout and three nights in camp.
//
// Every assertion here failed before the pipeline became sampling-rate aware:
// detectPauses' fixed 10s gap threshold flagged *every* sample past the first
// as paused, which collapsed moving time and made avg speed nonsense. That is
// the regression this file exists to hold down.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { insertGapBreaks } from '../../domain/insertGapBreaks.js'
import { gapThresholdFor } from '../../domain/samplingInterval.js'
import { formatDuration } from '../../domain/units.js'
import { metricRegistry } from '../../metrics/metricRegistry.js'
import { computeMetricStat, computeYDomain } from '../../stats/aggregate.js'
import { GpxActivitySource } from './GpxActivitySource.js'

const gpxXml = readFileSync(join(process.cwd(), 'fixtures', 'sparse-multiday.gpx'), 'utf-8')

async function loadFixtureActivity() {
  const file = new File([gpxXml], 'sparse-multiday.gpx', { type: 'application/gpx+xml' })
  return new GpxActivitySource().load({ type: 'file', file })
}

describe('sparse multi-day GPX (fixtures/sparse-multiday.gpx)', () => {
  it('resolves to the generic track sport, since the file has no <type>', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.sport).toBe('track')
  })

  it('names itself by duration rather than by a time-of-day bucket', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.name).toBe('3-day Track')
  })

  it('measures its own 10-minute cadence', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.samplingIntervalS).toBe(600)
    expect(gapThresholdFor(activity.samplingIntervalS)).toBe(2400)
  })

  it('offers speed and elevation only — the channels a GPS-only log has', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.availableMetrics).toEqual(['pace', 'speed', 'altitude'])
  })

  it('keeps ordinary breadcrumbs moving, and marks only the four real gaps', async () => {
    const activity = await loadFixtureActivity()
    const paused = activity.samples.filter((s) => !s.moving)

    expect(paused.length).toBe(4) // the sample resuming after each night/dropout

    // 44 intervals, less the 4 that span a night or the dropout: 40 x 600s.
    // `> 0` passed on the old answer of 71.33h, which was 12x wrong — the
    // three nights and the outage were all being counted as moving time.
    expect(activity.totalMovingTime).toBe(24000)
    expect(activity.totalTime).toBe(259200) // 72h elapsed, for contrast
  })

  it('reports a plausible average speed — the number that used to read 0:02 min/km as pace', async () => {
    const activity = await loadFixtureActivity()
    const avgKmh = computeMetricStat({
      samples: activity.samples,
      metric: metricRegistry.speed,
      statKind: 'avg',
      totalMovingTime: activity.totalMovingTime,
      totalDistance: activity.totalDistance,
    })

    // Walking pace over a 3-day, ~49 km trek.
    expect(avgKmh).toBeGreaterThan(2)
    expect(avgKmh).toBeLessThan(8)
  })

  it('reports a walkable average pace — the stat that read 90:04 min/km while nights counted as moving', async () => {
    const activity = await loadFixtureActivity()
    const avgPaceSPerKm = computeMetricStat({
      samples: activity.samples,
      metric: metricRegistry.pace,
      statKind: 'avg',
      totalMovingTime: activity.totalMovingTime,
      totalDistance: activity.totalDistance,
      gapThresholdS: gapThresholdFor(activity.samplingIntervalS),
    })

    // 24000s over 47.52 km (haversine) = 505.01 s/km, i.e. 8:25 min/km.
    expect(avgPaceSPerKm).toBeCloseTo(505.01, 1)
    expect(formatDuration(Math.round(avgPaceSPerKm))).toBe('8:25')
  })

  it('gives the speed panel a real y-domain instead of collapsing to a single sample', async () => {
    const activity = await loadFixtureActivity()
    const [min, max] = computeYDomain({ samples: activity.samples, metric: metricRegistry.speed })
    // The degenerate case: one surviving moving sample makes min === max, pad
    // falls back to 1, and allowDataOverflow clips the whole series away.
    expect(max - min).toBeGreaterThan(1)
  })

  it('breaks the plotted line at every dropout, since sparse data carries no nulls of its own', async () => {
    const activity = await loadFixtureActivity()
    const rows = activity.samples.map((s) => ({ t: s.t, d: s.d, speed: metricRegistry.speed.accessor(s) }))
    const withBreaks = insertGapBreaks(rows, {
      valueKeys: ['speed'],
      gapThresholdS: gapThresholdFor(activity.samplingIntervalS),
    })

    expect(withBreaks.filter((r) => r.speed === null)).toHaveLength(4)
    expect(withBreaks).toHaveLength(rows.length + 4)
  })

  it('prints its elapsed total in days, not as a running hour count', async () => {
    const activity = await loadFixtureActivity()
    expect(formatDuration(activity.totalTime)).toBe('3d 0:00:00')
  })
})
