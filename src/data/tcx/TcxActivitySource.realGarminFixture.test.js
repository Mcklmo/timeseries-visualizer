// Cross-check against a real Garmin TCX export, per ARCHITECTURE.md §11's
// definition of done: "have average pace match what Garmin Connect reports
// for the same file." fixtures/activity_23870166877-meta.json holds the
// numbers Garmin itself reported for this activity. This file also happens
// to have no <Watts> anywhere — the "at least one missing metric" case §11
// step 8 asks to test against.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatPace } from '../../domain/units.js'
import { metricRegistry } from '../../metrics/metricRegistry.js'
import { computeMetricStat } from '../../stats/aggregate.js'
import { TcxActivitySource } from './TcxActivitySource.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const tcxXml = readFileSync(join(FIXTURE_DIR, 'activity_23870166877.tcx'), 'utf-8')
const meta = JSON.parse(readFileSync(join(FIXTURE_DIR, 'activity_23870166877-meta.json'), 'utf-8'))

async function loadFixtureActivity() {
  const file = new File([tcxXml], 'activity_23870166877.tcx', { type: 'application/vnd.garmin.tcx+xml' })
  return new TcxActivitySource().load({ type: 'file', file })
}

describe('real Garmin export cross-check (fixtures/activity_23870166877.tcx)', () => {
  it('parses the full trackpoint history without throwing', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.samples.length).toBeGreaterThan(1000)
    expect(activity.sport).toBe('running')
  })

  it('total distance matches what Garmin reported, within rounding of the recorded 2-decimal km figure', async () => {
    const activity = await loadFixtureActivity()
    const expectedMetres = meta.actual_distance_km * 1000
    // meta.json's actual_distance_km is human-rounded to 2 decimals (±5m); allow a bit of slack
    expect(Math.abs(activity.totalDistance - expectedMetres)).toBeLessThan(10)
  })

  it('total time matches the reported duration, within 1 second', async () => {
    const activity = await loadFixtureActivity()
    expect(Math.abs(activity.totalTime - meta.actual_duration_min * 60)).toBeLessThan(1)
  })

  it('average pace matches what Garmin reported, within 1 second/km — the AM-HM-inequality regression test', async () => {
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

  it('has no power metric available — this export has no power meter data', async () => {
    const activity = await loadFixtureActivity()
    expect(activity.availableMetrics).not.toContain('power')
    expect(activity.availableMetrics).toEqual(expect.arrayContaining(['pace', 'heartRate', 'cadence', 'altitude']))
  })
})
