// Cross-check against the real Garmin FIT export for the same activity as
// TcxActivitySource.realGarminFixture.test.js (fixtures/23870166877_ACTIVITY.fit,
// Garmin activity id 23870166877). The TCX export of this same activity has
// no <Watts> anywhere — Garmin Connect's FIT→TCX exporter drops the Stryd
// pod's power data. This test proves the FIT parser recovers it directly
// from the source file, which is the whole point of this feature.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatPace } from '../../domain/units.js'
import { metricRegistry } from '../../metrics/metricRegistry.js'
import { computeMetricStat } from '../../stats/aggregate.js'
import { FitActivitySource } from './FitActivitySource.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const fitBytes = readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit'))
const meta = JSON.parse(readFileSync(join(FIXTURE_DIR, 'activity_23870166877-meta.json'), 'utf-8'))

async function loadFixtureActivity() {
  const file = new File([fitBytes], '23870166877_ACTIVITY.fit', { type: 'application/vnd.ant.fit' })
  return new FitActivitySource().load({ type: 'file', file })
}

describe('real Garmin export cross-check (fixtures/23870166877_ACTIVITY.fit)', () => {
  it('parses the full trackpoint history without throwing', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.samples.length).toBeGreaterThan(1700)
    expect(activity.sport).toBe('running')
  })

  it('total distance matches what Garmin reported, within rounding of the recorded 2-decimal km figure', async () => {
    const activity = await loadFixtureActivity()
    const expectedMetres = meta.actual_distance_km * 1000
    expect(Math.abs(activity.totalDistance - expectedMetres)).toBeLessThan(10)
  })

  it('total time matches the reported duration, within 1 second', async () => {
    const activity = await loadFixtureActivity()
    expect(Math.abs(activity.totalTime - meta.actual_duration_min * 60)).toBeLessThan(1)
  })

  it('average pace matches what Garmin reported, within 1 second/km', async () => {
    const activity = await loadFixtureActivity()

    const avgPaceSecPerKm = computeMetricStat({
      samples: activity.samples,
      metric: metricRegistry.pace,
      statKind: 'avg',
      totalMovingTime: activity.totalMovingTime,
      totalDistance: activity.totalDistance,
    })

    const expectedSecPerKm = meta.actual_avg_pace_min * 60 + meta.actual_avg_pace_sec
    expect(Math.abs(avgPaceSecPerKm - expectedSecPerKm)).toBeLessThan(1)

    const expectedLabel = `${meta.actual_avg_pace_min}:${String(meta.actual_avg_pace_sec).padStart(2, '0')}`
    expect(formatPace(avgPaceSecPerKm)).toBe(expectedLabel)
  })

  it('has power available — recovered from the Stryd developer field the TCX export drops', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.availableMetrics).toContain('power')
    expect(activity.availableMetrics).toEqual(
      expect.arrayContaining(['pace', 'heartRate', 'cadence', 'altitude', 'power']),
    )

    const avgPowerWatts = computeMetricStat({
      samples: activity.samples,
      metric: metricRegistry.power,
      statKind: 'avg',
      totalMovingTime: activity.totalMovingTime,
      totalDistance: activity.totalDistance,
    })
    // Sane band, not an exact figure — avoids overfitting to pipeline rounding.
    expect(avgPowerWatts).toBeGreaterThan(150)
    expect(avgPowerWatts).toBeLessThan(300)
  })
})
