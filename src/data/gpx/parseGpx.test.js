import { describe, it, expect } from 'vitest'
import { parseGpx } from './parseGpx.js'

const GPX_11 = 'http://www.topografix.com/GPX/1/1'
const GPX_10 = 'http://www.topografix.com/GPX/1/0'

function gpx({ ns = GPX_11, name = 'Morning walk', typeXml = '', segmentsXml = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="${ns}">
  <trk>
    <name>${name}</name>
    ${typeXml}
    ${segmentsXml}
  </trk>
</gpx>`
}

function trkpt({ lat = 57.01, lon = 9.97, ele = '12.6', time = '2026-01-01T00:00:00.000Z' } = {}) {
  return `<trkpt lat="${lat}" lon="${lon}">
    ${ele == null ? '' : `<ele>${ele}</ele>`}
    ${time == null ? '' : `<time>${time}</time>`}
  </trkpt>`
}

const seg = (points) => `<trkseg>${points.join('')}</trkseg>`

describe('parseGpx', () => {
  it('reads lat/lon from the trkpt attributes, and ele/time from child elements', () => {
    const result = parseGpx(
      gpx({ segmentsXml: seg([trkpt({ lat: 57.01, lon: 9.97, ele: '12.6' })]) }),
    )

    expect(result.trackpoints).toHaveLength(1)
    expect(result.trackpoints[0]).toMatchObject({
      lat: 57.01,
      lon: 9.97,
      altitudeMeters: 12.6,
      time: new Date('2026-01-01T00:00:00.000Z'),
    })
  })

  it('maps the fields GPX simply does not carry to null rather than inventing them', () => {
    const [tp] = parseGpx(gpx({ segmentsXml: seg([trkpt()]) })).trackpoints
    expect(tp.distanceMeters).toBeNull()
    expect(tp.speedMps).toBeNull()
    expect(tp.heartRateBpm).toBeNull()
    expect(tp.cadenceSpm).toBeNull()
    expect(tp.watts).toBeNull()
  })

  it('parses a GPX 1.0 document, whose namespace differs by one character', () => {
    const result = parseGpx(gpx({ ns: GPX_10, segmentsXml: seg([trkpt(), trkpt({ time: '2026-01-01T00:00:10.000Z' })]) }))
    expect(result.trackpoints).toHaveLength(2)
  })

  it('flattens every trkseg into one array, the way parseTcx flattens laps', () => {
    const result = parseGpx(
      gpx({
        segmentsXml:
          seg([trkpt(), trkpt({ time: '2026-01-01T00:00:10.000Z' })]) +
          seg([trkpt({ time: '2026-01-01T06:00:00.000Z' })]),
      }),
    )
    expect(result.trackpoints).toHaveLength(3)
  })

  it('handles a track point with no <ele> — elevation is optional', () => {
    const [tp] = parseGpx(gpx({ segmentsXml: seg([trkpt({ ele: null })]) })).trackpoints
    expect(tp.altitudeMeters).toBeNull()
    expect(tp.lat).toBe(57.01)
  })

})

describe('parseGpx sport resolution', () => {
  const sportOf = (type) =>
    parseGpx(gpx({ typeXml: type == null ? '' : `<type>${type}</type>`, segmentsXml: seg([trkpt()]) })).sport

  it('recognises the common running and cycling <type> spellings, case-insensitively', () => {
    for (const type of ['run', 'Running', 'JOGGING']) expect(sportOf(type)).toBe('running')
    for (const type of ['bike', 'Biking', 'cycling', 'cycle', 'Ride']) expect(sportOf(type)).toBe('cycling')
  })

  it('falls back to the generic track sport when <type> is absent', () => {
    expect(sportOf(null)).toBe('track')
  })

  it("falls back to 'track' for an unrecognised <type>, e.g. Strava's numeric code", () => {
    expect(sportOf('9')).toBe('track')
    expect(sportOf('kayaking')).toBe('track')
  })

  it('ignores a <link><type> MIME type, which document order would otherwise pick first', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="${GPX_11}">
  <metadata><link href="https://example.com"><type>text/html</type></link></metadata>
  <trk>
    <link href="https://example.com"><type>text/html</type></link>
    <type>running</type>
    ${seg([trkpt()])}
  </trk>
</gpx>`
    expect(parseGpx(xml).sport).toBe('running')
  })
})

describe('parseGpx errors', () => {
  it('rejects invalid XML with the shared message', () => {
    expect(() => parseGpx('not xml at all <<<')).toThrow(/isn't valid XML/i)
  })

  it('rejects a well-formed document that is not GPX', () => {
    const tcxish = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"/>`
    expect(() => parseGpx(tcxish)).toThrow(/is it a GPX export/i)
  })

  it('rejects a <gpx> root in an unknown namespace rather than guessing', () => {
    const wrongNs = `<?xml version="1.0"?><gpx xmlns="http://example.com/gpx"><trk>${seg([trkpt()])}</trk></gpx>`
    expect(() => parseGpx(wrongNs)).toThrow(/is it a GPX export/i)
  })

  it('rejects a GPX file with no track points', () => {
    expect(() => parseGpx(gpx({ segmentsXml: '' }))).toThrow(/doesn't contain any track points/i)
  })

  it('rejects a route/waypoint export specifically — track points but no timestamps', () => {
    // The error TCX and FIT have no analogue for: <time> is optional in GPX.
    const routeLike = gpx({ segmentsXml: seg([trkpt({ time: null }), trkpt({ time: null })]) })
    expect(() => parseGpx(routeLike)).toThrow(/no timestamps/i)
    expect(() => parseGpx(routeLike)).toThrow(/route or waypoint list/i)
  })
})

describe('parseGpx layering', () => {
  it('does not drop or interpret a partially-empty track point — that is normalizeActivity\'s job', () => {
    // Mirrors parseTcx's own layering test: adapters do field mapping only.
    const result = parseGpx(
      gpx({ segmentsXml: seg([trkpt(), `<trkpt><time>2026-01-01T00:00:10.000Z</time></trkpt>`]) }),
    )
    expect(result.trackpoints).toHaveLength(2)
    expect(result.trackpoints[1].lat).toBeNull()
  })
})
