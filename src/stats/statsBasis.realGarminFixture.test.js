// Windowed stats against the real Garmin FIT export (fixtures/23870166877_ACTIVITY.fit,
// the same 30-minute activity as the four adapter cross-checks). The plan for
// "stats follow the zoom window" called for this to be checked by hand in the
// browser against a known split; that check is automated here instead, because
// the number it protects — average pace over a window — is the one that can be
// wrong while looking entirely reasonable, and a manual pass protects it only
// on the day someone does it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FitActivitySource } from '../data/fit/FitActivitySource.js'
import { formatPace } from '../domain/units.js'
import { extentOf, fullDomain } from '../domain/zoomDomain.js'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { computeMetricStat } from './aggregate.js'
import { statsBasisFor } from './statsBasis.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const fitBytes = readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit'))
const meta = JSON.parse(readFileSync(join(FIXTURE_DIR, 'activity_23870166877-meta.json'), 'utf-8'))

let cached
async function loadFixtureActivity() {
  const file = new File([fitBytes], '23870166877_ACTIVITY.fit', { type: 'application/vnd.ant.fit' })
  cached ??= await new FitActivitySource().load({ type: 'file', file })
  return cached
}

const avgPaceOf = (basis) =>
  computeMetricStat({ ...basis, metric: metricRegistry.pace, statKind: 'avg' })

const basisFor = (activity, zoomDomain) =>
  statsBasisFor(activity, 't', zoomDomain, extentOf(activity.samples, 't'))

describe('windowed stats on the real Garmin export', () => {
  it('still reports Garmin\'s own average pace while unzoomed', async () => {
    const activity = await loadFixtureActivity()
    const reportedSecPerKm = meta.actual_avg_pace_min * 60 + meta.actual_avg_pace_sec
    const avgPace = avgPaceOf(basisFor(activity, fullDomain()))
    expect(Math.abs(avgPace - reportedSecPerKm)).toBeLessThan(1)
    expect(formatPace(avgPace)).toBe(
      `${meta.actual_avg_pace_min}:${String(meta.actual_avg_pace_sec).padStart(2, '0')}`,
    )
  })

  it('reports a mid-run window from that window alone, not the whole run', async () => {
    const activity = await loadFixtureActivity()
    const window = [600, 1200] // minutes 10-20 of a 30-minute run
    const basis = basisFor(activity, window)

    // Independently recomputed from the raw samples, without going through
    // sliceSamples/sampleDurations at all — if the basis quietly kept the
    // activity's own totals, this is what catches it.
    const inWindow = activity.samples.filter((s) => s.t >= window[0] && s.t <= window[1])
    const expectedDistance = inWindow.at(-1).d - inWindow[0].d
    let expectedMovingTime = 0
    for (let i = 0; i < inWindow.length - 1; i++) {
      const dt = inWindow[i + 1].t - inWindow[i].t
      const stopped = inWindow[i].moving === false && inWindow[i + 1].moving === false
      if (dt > 0 && dt <= 10 && !stopped) expectedMovingTime += dt
    }

    expect(basis.samples).toHaveLength(inWindow.length)
    expect(basis.totalDistance).toBeCloseTo(expectedDistance, 6)
    expect(basis.totalMovingTime).toBeCloseTo(expectedMovingTime, 6)
    expect(avgPaceOf(basis)).toBeCloseTo((expectedMovingTime / expectedDistance) * 1000, 6)

    // And it is a genuinely different number from the whole run's — a window
    // that happened to match would make every assertion above vacuous.
    expect(Math.abs(avgPaceOf(basis) - avgPaceOf(basisFor(activity, fullDomain())))).toBeGreaterThan(1)
  })

  it('renders a plausible pace, never NaN, at the deepest zoom the gesture allows', async () => {
    const activity = await loadFixtureActivity()
    const [min, max] = extentOf(activity.samples, 't')
    const span = (max - min) / 50 // MAX_ZOOM
    const start = min + (max - min) / 3

    const basis = basisFor(activity, [start, start + span])
    for (const statKind of ['max', 'min', 'avg', 'median']) {
      const value = computeMetricStat({ ...basis, metric: metricRegistry.pace, statKind })
      expect(Number.isNaN(value)).toBe(false)
      expect(formatPace(value)).not.toContain('NaN')
    }
    // 36 s of a 1 Hz recording is ~36 samples and a real, sane pace.
    expect(avgPaceOf(basis)).toBeGreaterThan(120)
    expect(avgPaceOf(basis)).toBeLessThan(900)
  })
})
