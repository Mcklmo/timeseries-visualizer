// The share codec against a real Garmin export, per ARCHITECTURE.md §11's
// definition of done applied to the SHARED COPY: the activity that comes out
// of a share link has to pass the same Garmin-Connect cross-check the
// original does. Also the size pin — the number issue #4 is actually about.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeMetricStat } from '../../stats/aggregate.js'
import { metricRegistry } from '../../metrics/metricRegistry.js'
import { unprojectXY } from '../../domain/webMercator.js'
import { TcxActivitySource } from '../tcx/TcxActivitySource.js'
import { SharedActivitySource } from './SharedActivitySource.js'
import { SHARE_URL_MAX_CHARS, decodePayload, encodeActivityToPayload } from './shareCodec.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const tcxXml = readFileSync(join(FIXTURE_DIR, 'activity_23870166877.tcx'), 'utf-8')
const meta = JSON.parse(readFileSync(join(FIXTURE_DIR, 'activity_23870166877-meta.json'), 'utf-8'))

async function loadOriginal() {
  const file = new File([tcxXml], 'activity_23870166877.tcx', { type: 'application/vnd.garmin.tcx+xml' })
  return new TcxActivitySource().load({ type: 'file', file })
}

async function shareRoundTrip() {
  const original = await loadOriginal()
  const payload = await encodeActivityToPayload(original)
  const shared = await new SharedActivitySource().load({ type: 'shared', payload })
  return { original, payload, shared }
}

/** Great-circle metres between two lat/lon pairs — small-angle exact enough here. */
function haversineMetres(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(s))
}

describe('share codec against the real Garmin export', () => {
  it('encodes a 30-minute 1 Hz run at FULL resolution, comfortably inside the budget', async () => {
    const { original, payload, shared } = await shareRoundTrip()
    // ~5.5K measured when this feature landed. The 8K tripwire fires on
    // format regressions long before links approach SHARE_URL_MAX_CHARS.
    expect(payload.length).toBeLessThan(8000)
    expect(payload.length).toBeLessThan(SHARE_URL_MAX_CHARS)
    expect(shared.samples).toHaveLength(original.samples.length)
  })

  it('the shared copy keeps the totals Garmin reported', async () => {
    const { original, shared } = await shareRoundTrip()
    expect(Math.abs(shared.totalDistance - original.totalDistance)).toBeLessThan(0.2)
    expect(Math.abs(shared.totalTime - original.totalTime)).toBeLessThan(0.1)
    expect(shared.sport).toBe(original.sport)
    expect(shared.name).toBe(original.name)
    expect(shared.startTime.getTime() - original.startTime.getTime()).toBeLessThan(1000)
  })

  it('the shared copy offers exactly the same metrics', async () => {
    const { original, shared } = await shareRoundTrip()
    expect([...shared.availableMetrics].sort()).toEqual([...original.availableMetrics].sort())
    // This export famously has no power — the share must not invent one.
    expect(shared.availableMetrics).not.toContain('power')
  })

  it('per-sample values survive within their quantization grids', async () => {
    const { original, shared } = await shareRoundTrip()
    for (let i = 0; i < original.samples.length; i += 1) {
      const a = original.samples[i]
      const b = shared.samples[i]
      // 0.051, not 0.05: the grid is half a decimeter, plus float epsilon.
      expect(Math.abs(b.t - a.t)).toBeLessThanOrEqual(0.051)
      expect(Math.abs(b.d - a.d)).toBeLessThanOrEqual(0.051)
      if (a.heartRate != null) expect(b.heartRate).toBe(Math.round(a.heartRate))
      if (a.cadence != null) expect(b.cadence).toBe(Math.round(a.cadence))
      if (a.altitude != null) expect(Math.abs(b.altitude - a.altitude)).toBeLessThanOrEqual(0.05)
      if (a.speed != null) expect(Math.abs(b.speed - a.speed)).toBeLessThanOrEqual(0.005)
    }
  })

  it('the route survives within ~1.5 m per fix, gaps included', async () => {
    const { original, shared } = await shareRoundTrip()
    expect(shared.track).not.toBeNull()
    expect(shared.track.fixCount).toBe(original.track.fixCount)
    for (let i = 0; i < original.samples.length; i += 1) {
      const originalHasFix = Number.isFinite(original.track.x[i])
      expect(Number.isFinite(shared.track.x[i])).toBe(originalHasFix)
      if (!originalHasFix) continue
      const distance = haversineMetres(
        unprojectXY(original.track.x[i], original.track.y[i]),
        unprojectXY(shared.track.x[i], shared.track.y[i]),
      )
      // 1e-5° of both lat and lon is ~1.4 m diagonal at this latitude.
      expect(distance).toBeLessThanOrEqual(1.5)
    }
  })

  it('the shared copy still matches the pace Garmin Connect reported, within 1 s/km', async () => {
    const { shared } = await shareRoundTrip()
    const avgPaceSecPerKm = computeMetricStat({
      samples: shared.samples,
      metric: metricRegistry.pace,
      statKind: 'avg',
      totalMovingTime: shared.totalMovingTime,
      totalDistance: shared.totalDistance,
    })
    const expectedSecPerKm = meta.actual_avg_pace_min * 60 + meta.actual_avg_pace_sec
    expect(Math.abs(avgPaceSecPerKm - expectedSecPerKm)).toBeLessThan(1)
  })

  it('re-sharing a shared activity is lossless — generations do not degrade', async () => {
    const { payload, shared } = await shareRoundTrip()
    const secondPayload = await encodeActivityToPayload(shared)
    expect(secondPayload).toBe(payload)
    // And the decoded forms agree exactly.
    const decodedTwice = await decodePayload(secondPayload)
    const decodedOnce = await decodePayload(payload)
    expect(decodedTwice.trackpoints).toEqual(decodedOnce.trackpoints)
  })
})
