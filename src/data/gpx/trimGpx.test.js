import { describe, it, expect } from 'vitest'
import { parseGpx } from './parseGpx.js'
import { trimGpx } from './trimGpx.js'

const T0 = new Date('2026-01-01T06:00:00.000Z')

const at = (s) => new Date(T0.getTime() + s * 1000).toISOString()

function trkpt(s, { lat = 57, lon = 10, extras = '' } = {}) {
  return `      <trkpt lat="${lat}" lon="${lon}">
        <ele>12.6</ele>
        <time>${at(s)}</time>${extras}
      </trkpt>`
}

/**
 * @param {object} options
 * @param {number[][]} options.segments - one array of second-offsets per <trkseg>
 */
function gpxDoc({
  segments = [[0, 1, 2, 3, 4]],
  ns = 'http://www.topografix.com/GPX/1/1',
  metadata = `  <metadata>\n    <time>${at(0)}</time>\n  </metadata>\n`,
  extras = '',
} = {}) {
  const segs = segments
    .map((offsets) => `    <trkseg>\n${offsets.map((s) => trkpt(s)).join('\n')}\n    </trkseg>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="${ns}" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
${metadata}  <trk>
    <name>A run</name>
    <type>running</type>
${segs}
  </trk>${extras}
</gpx>`
}

const window = (fromS, toS) => ({
  from: new Date(T0.getTime() + fromS * 1000),
  to: new Date(T0.getTime() + toS * 1000),
})

/** Re-reads the trimmed text through the app's own parser. */
const reparse = (text) => parseGpx(text)

const countTrkpts = (text) => (text.match(/<trkpt\b/g) ?? []).length

describe('trimGpx', () => {
  it('keeps the points inside the window and drops the rest, both ends inclusive', () => {
    const out = trimGpx(gpxDoc({ segments: [[0, 1, 2, 3, 4, 5, 6]] }), window(2, 5))

    const times = reparse(out).trackpoints.map((tp) => tp.time.toISOString())
    // 4 points, not 3: seconds 2 and 5 are both boundary seconds and both stay.
    expect(times).toEqual([at(2), at(3), at(4), at(5)])
  })

  it('starts the output with the XML declaration XMLSerializer drops', () => {
    const out = trimGpx(gpxDoc(), window(1, 3))
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('trims a GPX 1.0 document as readily as a 1.1 one', () => {
    const out = trimGpx(
      gpxDoc({ ns: 'http://www.topografix.com/GPX/1/0', segments: [[0, 1, 2, 3, 4]] }),
      window(1, 3),
    )
    expect(out).toContain('http://www.topografix.com/GPX/1/0')
    expect(countTrkpts(out)).toBe(3)
  })

  it('rejects a document that is not GPX at all', () => {
    expect(() => trimGpx('<TrainingCenterDatabase/>', window(0, 10))).toThrow(/is it a GPX export/)
  })

  it('removes a <trkseg> the window emptied, and keeps the one it did not', () => {
    const out = trimGpx(gpxDoc({ segments: [[0, 1, 2], [50, 51, 52]] }), window(0, 2))

    expect((out.match(/<trkseg>/g) ?? []).length).toBe(1)
    expect(countTrkpts(out)).toBe(3)
  })

  it('removes a <trk> whose every segment the window emptied', () => {
    const doc = gpxDoc({ segments: [[0, 1, 2]] }).replace(
      '</gpx>',
      `  <trk>\n    <name>Later</name>\n    <trkseg>\n${trkpt(500)}\n${trkpt(501)}\n    </trkseg>\n  </trk>\n</gpx>`,
    )
    const out = trimGpx(doc, window(0, 2))

    expect((out.match(/<trk>/g) ?? []).length).toBe(1)
    expect(out).not.toContain('Later')
  })

  it('carries a gpxtpx extension through untouched', () => {
    const extras = `
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>142</gpxtpx:hr>
          </gpxtpx:TrackPointExtension>
        </extensions>`
    const doc = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><trkseg>
${trkpt(0, { extras })}
${trkpt(1, { extras })}
${trkpt(2, { extras })}
  </trkseg></trk>
</gpx>`
    const out = trimGpx(doc, window(1, 2))

    expect(countTrkpts(out)).toBe(2)
    expect((out.match(/<gpxtpx:hr>142<\/gpxtpx:hr>/g) ?? []).length).toBe(2)
  })

  it('drops a <trkpt> with no <time> — it cannot be placed in or out of the window', () => {
    const doc = gpxDoc({ segments: [[0, 1, 2]] }).replace(
      '    </trkseg>',
      '      <trkpt lat="57" lon="10"><ele>12</ele></trkpt>\n    </trkseg>',
    )
    const out = trimGpx(doc, window(0, 2))

    expect(countTrkpts(out)).toBe(3)
  })

  it('updates <metadata><time> to the first kept point', () => {
    const out = trimGpx(gpxDoc({ segments: [[0, 1, 2, 3, 4]] }), window(2, 4))
    expect(out).toContain(`<metadata>\n    <time>${at(2)}</time>`)
  })

  it('does not CREATE a <metadata><time> where the exporter wrote none', () => {
    const out = trimGpx(gpxDoc({ metadata: '' }), window(1, 3))
    expect(out).not.toContain('<metadata>')
  })

  it('leaves <wpt> and the track name alone — athlete annotations, not the recording', () => {
    const doc = gpxDoc({ extras: `\n  <wpt lat="57" lon="10"><name>Water</name></wpt>` })
    const out = trimGpx(doc, window(1, 3))

    expect(out).toContain('<wpt lat="57" lon="10">')
    expect(out).toContain('<name>A run</name>')
  })

  it('refuses a window holding fewer than two points', () => {
    expect(() => trimGpx(gpxDoc(), window(1, 1))).toThrow(
      "That zoom window doesn't contain enough of this file to export",
    )
  })
})
