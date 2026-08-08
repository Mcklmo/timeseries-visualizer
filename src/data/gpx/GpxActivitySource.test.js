import { describe, it, expect } from 'vitest'
import { GpxActivitySource } from './GpxActivitySource.js'

// Two consecutive positions ~15m apart, 10s apart in time.
const validGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Test track</name>
    <trkseg>
      <trkpt lat="57.010000" lon="9.970000"><ele>12.0</ele><time>2026-01-01T00:00:00.000Z</time></trkpt>
      <trkpt lat="57.010135" lon="9.970000"><ele>13.0</ele><time>2026-01-01T00:00:10.000Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

function fileOf(text, name = 'track.gpx') {
  return new File([text], name, { type: 'application/gpx+xml' })
}

describe('GpxActivitySource', () => {
  it('has kind "gpx"', () => {
    expect(new GpxActivitySource().kind).toBe('gpx')
  })

  it('loads a file ref through parseGpx + normalizeActivity into a full Activity', async () => {
    const activity = await new GpxActivitySource().load({ type: 'file', file: fileOf(validGpx) })

    expect(activity.sport).toBe('track')
    expect(activity.samples).toHaveLength(2)
    expect(activity.totalTime).toBe(10)
  })

  it('reconstructs the distance axis from lat/lon, since GPX carries no distance', async () => {
    const activity = await new GpxActivitySource().load({ type: 'file', file: fileOf(validGpx) })
    // 0.000135° of latitude is ~15m
    expect(activity.totalDistance).toBeGreaterThan(10)
    expect(activity.totalDistance).toBeLessThan(20)
  })

  it('offers speed and elevation only — no sensor channels exist in a plain GPX', async () => {
    const activity = await new GpxActivitySource().load({ type: 'file', file: fileOf(validGpx) })
    expect(activity.availableMetrics).toEqual(['pace', 'speed', 'altitude'])
    expect(activity.availableMetrics).not.toContain('heartRate')
    expect(activity.availableMetrics).not.toContain('power')
  })

  it('rejects a non-file ref', async () => {
    await expect(new GpxActivitySource().load({ type: 'id', id: 'sample' })).rejects.toThrow(/file/i)
  })

  it("rejects with the parser's specific error message for a malformed file", async () => {
    await expect(
      new GpxActivitySource().load({ type: 'file', file: fileOf('not xml at all <<<') }),
    ).rejects.toThrow(/isn't valid XML/i)
  })
})
