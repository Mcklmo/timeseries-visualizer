// The test that proves the premise of the whole intervals.icu route.
//
// fixtures/23870166877_ACTIVITY.fit is the same Garmin activity that
// TcxActivitySource.realGarminFixture.test.js, FitActivitySource's and
// GpxActivitySource's cross-checks assert against. Here it is served
// **gzipped, over a stubbed fetch**, exactly as intervals.icu's
// /activity/{id}/file endpoint serves an original upload — and it has to come
// out at the same numbers.
//
// One activity, four routes (file-TCX, file-FIT, file-GPX, network-FIT),
// identical figures. That is the proof the network path reaches full
// original-file fidelity rather than a downgraded re-export: power especially,
// which lives in a Stryd developer field that Garmin Connect's own TCX export
// drops and intervals.icu's regenerated /fit-file would not carry either.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatPace } from '../../domain/units.js'
import { metricRegistry } from '../../metrics/metricRegistry.js'
import { computeMetricStat } from '../../stats/aggregate.js'
import { FitActivitySource } from '../fit/FitActivitySource.js'
import { IntervalsActivitySource } from './IntervalsActivitySource.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const fitBytes = new Uint8Array(readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit')))
const meta = JSON.parse(readFileSync(join(FIXTURE_DIR, 'activity_23870166877-meta.json'), 'utf-8'))

// Response, not Blob — see detectActivityFormat.js for why mixing jsdom's
// Blob with Node's streams breaks under this test environment.
async function gzip(bytes) {
  const compressed = await new Response(
    new Response(bytes).body.pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  return new Uint8Array(compressed)
}

async function loadFixtureActivity(ref = { type: 'id', id: 'i23870166877' }) {
  const gzipped = await gzip(fitBytes)
  const fetchImpl = vi.fn(async () => new Response(gzipped, { status: 200 }))
  const source = new IntervalsActivitySource({ getApiKey: () => 'test-key', fetchImpl })
  return source.load(ref)
}

describe('real Garmin original downloaded from intervals.icu (gzipped fixtures/23870166877_ACTIVITY.fit)', () => {
  it('inflates and parses the full trackpoint history without throwing', async () => {
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

  it('average pace matches what Garmin reported, to the second', async () => {
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

  // The single most load-bearing assertion in this file: Stryd power lives in
  // a FIT developer field. It survives only because /file serves the original
  // upload — a re-export or a regenerated file would arrive without it.
  it('has power available, recovered from the Stryd developer field, exactly as the dropped-file route does', async () => {
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
    expect(avgPowerWatts).toBeGreaterThan(150)
    expect(avgPowerWatts).toBeLessThan(300)
  })

  it('carries the picker\'s real title through onto the activity', async () => {
    const activity = await loadFixtureActivity({ type: 'id', id: 'i23870166877', name: 'Aalborg tempo' })
    expect(activity.name).toBe('Aalborg tempo')
  })

  // The cross-path guarantee the content fingerprint exists for
  // (domain/activityKey.js): this file downloaded from intervals.icu and the
  // same file dropped onto the page are ONE activity as far as the remembered
  // chart view is concerned (§10), not two.
  //
  // The title override is the trap this pins. It is applied *after*
  // normalizeActivity returns, so a key that included `name` would silently
  // fork the two routes apart — and only for activities the picker had a
  // title for, which is the subset hardest to notice.
  it('produces the same id as dropping that same file in, title override and all', async () => {
    const downloaded = await loadFixtureActivity({ type: 'id', id: 'i23870166877', name: 'Aalborg tempo' })
    const file = new File([fitBytes], '23870166877_ACTIVITY.fit', { type: 'application/vnd.ant.fit' })
    const dropped = await new FitActivitySource().load({ type: 'file', file })

    expect(downloaded.id).toBe(dropped.id)
    expect(downloaded.name).not.toBe(dropped.name)
    expect(dropped.id).toMatch(/^running-/)
  })
})
