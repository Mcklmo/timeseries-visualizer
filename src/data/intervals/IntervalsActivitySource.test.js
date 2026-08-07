import { describe, it, expect, vi } from 'vitest'
import { IntervalsActivitySource } from './IntervalsActivitySource.js'
import { IntervalsApiError } from './intervalsApi.js'

const encoder = new TextEncoder()

const validTcxXml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running">
    <Id>2026-01-01T00:00:00.000Z</Id>
    <Lap StartTime="2026-01-01T00:00:00.000Z"><Track>
      <Trackpoint><Time>2026-01-01T00:00:00.000Z</Time><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
      <Trackpoint><Time>2026-01-01T00:00:10.000Z</Time><DistanceMeters>30.0</DistanceMeters><HeartRateBpm><Value>125</Value></HeartRateBpm></Trackpoint>
    </Track></Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`

// GPX is a real, supported third format now, not a "not yet" — so a GPX
// original downloads and charts exactly like a dropped .gpx file.
const validGpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="57.010000" lon="9.970000"><ele>12.0</ele><time>2026-01-01T00:00:00.000Z</time></trkpt>
    <trkpt lat="57.010135" lon="9.970000"><ele>13.0</ele><time>2026-01-01T00:00:10.000Z</time></trkpt>
    <trkpt lat="57.010270" lon="9.970000"><ele>14.0</ele><time>2026-01-01T00:00:20.000Z</time></trkpt>
  </trkseg></trk>
</gpx>`

function sourceServing(body, { apiKey = 'test-key' } = {}) {
  const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }))
  const source = new IntervalsActivitySource({ getApiKey: () => apiKey, fetchImpl })
  return { source, fetchImpl }
}

describe('IntervalsActivitySource', () => {
  it('rejects a file ref — that is the other adapters\' job', async () => {
    const { source, fetchImpl } = sourceServing(encoder.encode(validTcxXml))

    await expect(
      source.load({ type: 'file', file: new File(['x'], 'run.tcx') }),
    ).rejects.toThrow(/can only load an id reference/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // A key cleared in another tab, or a Disconnect between rendering the list
  // and tapping a row. Reported as `unauthorized` so the picker's recovery
  // (clear the store, show the connect form) is the one that runs.
  it('throws without credentials, and never issues a request', async () => {
    const fetchImpl = vi.fn()
    const source = new IntervalsActivitySource({ getApiKey: () => null, fetchImpl })

    const error = await source.load({ type: 'id', id: 'i123' }).catch((e) => e)

    expect(error).toBeInstanceOf(IntervalsApiError)
    expect(error.code).toBe('unauthorized')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads the API key at call time, not at construction', async () => {
    let apiKey = 'first-key'
    const fetchImpl = vi.fn(async () => new Response(encoder.encode(validTcxXml), { status: 200 }))
    const source = new IntervalsActivitySource({ getApiKey: () => apiKey, fetchImpl })

    await source.load({ type: 'id', id: 'i123' })
    apiKey = null

    await expect(source.load({ type: 'id', id: 'i123' })).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('parses a downloaded TCX original through the same pipeline as a dropped file', async () => {
    const { source, fetchImpl } = sourceServing(encoder.encode(validTcxXml))

    const activity = await source.load({ type: 'id', id: 'i123' })

    expect(fetchImpl.mock.calls[0][0]).toContain('/activity/i123/file')
    expect(activity.sport).toBe('running')
    expect(activity.samples).toHaveLength(2)
    expect(activity.availableMetrics).toContain('heartRate')
  })

  it('parses a downloaded GPX original', async () => {
    const { source } = sourceServing(encoder.encode(validGpxXml))

    const activity = await source.load({ type: 'id', id: 'i123' })

    expect(activity.sport).toBe('track')
    expect(activity.availableMetrics).toEqual(expect.arrayContaining(['speed', 'altitude']))
  })

  it('detects the format from the bytes, whatever the file was called', async () => {
    // A ref carries no filename or file_type at all — which is exactly what
    // ErrorState's "Try again" replays.
    const { source } = sourceServing(encoder.encode(validGpxXml))
    await expect(source.load({ type: 'id', id: 'i123' })).resolves.toMatchObject({ sport: 'track' })
  })

  it('reports bytes it cannot recognise as an unreadable file', async () => {
    const { source } = sourceServing(encoder.encode('<kml xmlns="http://www.opengis.net/kml/2.2"/>'))

    const error = await source.load({ type: 'id', id: 'i123' }).catch((e) => e)

    expect(error).toBeInstanceOf(IntervalsApiError)
    expect(error.code).toBe('unsupported_format')
    expect(error.message).toMatch(/can't read/i)
  })

  it('lets an API failure propagate with its code intact, per the port contract', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }))
    const source = new IntervalsActivitySource({ getApiKey: () => 'k', fetchImpl })

    await expect(source.load({ type: 'id', id: 'i123' })).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringMatching(/doesn't allow access/i),
    })
  })

  describe('the real activity title from the ref (ARCHITECTURE.md §5)', () => {
    it('overrides the inferred name when the picker passed one', async () => {
      const { source } = sourceServing(encoder.encode(validTcxXml))

      const activity = await source.load({ type: 'id', id: 'i123', name: 'Tempo 5×1k' })

      expect(activity.name).toBe('Tempo 5×1k')
    })

    // Purely additive: a stub row has no name to pass, so the derived name
    // must stay a live fallback rather than becoming dead code.
    it('falls back to the derived name when the ref has none', async () => {
      const { source } = sourceServing(encoder.encode(validTcxXml))

      const activity = await source.load({ type: 'id', id: 'i123' })

      expect(activity.name).toBeTruthy()
      expect(activity.name).not.toBe('Tempo 5×1k')
    })
  })
})
