import { describe, it, expect } from 'vitest'
import { parseTcx } from './parseTcx.js'

function tcx({
  sport = 'Running',
  id = '2026-01-01T00:00:00.000Z',
  trackpointsXml = '',
} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="${sport}">
      <Id>${id}</Id>
      <Lap StartTime="${id}">
        <Track>
          ${trackpointsXml}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`
}

const fullTrackpoint = `
  <Trackpoint>
    <Time>2026-01-01T00:00:00.000Z</Time>
    <Position>
      <LatitudeDegrees>57.01</LatitudeDegrees>
      <LongitudeDegrees>9.97</LongitudeDegrees>
    </Position>
    <AltitudeMeters>12.6</AltitudeMeters>
    <DistanceMeters>0.0</DistanceMeters>
    <HeartRateBpm><Value>120</Value></HeartRateBpm>
    <Extensions>
      <ns3:TPX>
        <ns3:Speed>3.1</ns3:Speed>
        <ns3:RunCadence>85</ns3:RunCadence>
      </ns3:TPX>
    </Extensions>
  </Trackpoint>`

const bikeTrackpoint = `
  <Trackpoint>
    <Time>2026-01-01T00:00:00.000Z</Time>
    <DistanceMeters>0.0</DistanceMeters>
    <Cadence>85</Cadence>
    <Extensions>
      <ns3:TPX>
        <ns3:Speed>8.2</ns3:Speed>
      </ns3:TPX>
    </Extensions>
  </Trackpoint>`

describe('parseTcx', () => {
  it('extracts sport and field-mapped trackpoints', () => {
    const result = parseTcx(tcx({ trackpointsXml: fullTrackpoint }))
    expect(result.sport).toBe('running')
    expect(result.trackpoints).toHaveLength(1)

    const [p] = result.trackpoints
    expect(p.time).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(p.distanceMeters).toBe(0)
    expect(p.altitudeMeters).toBe(12.6)
    expect(p.heartRateBpm).toBe(120)
    expect(p.lat).toBe(57.01)
    expect(p.lon).toBe(9.97)
    expect(p.speedMps).toBe(3.1)
  })

  it('doubles RunCadence (strides/min) into steps/min', () => {
    const result = parseTcx(tcx({ trackpointsXml: fullTrackpoint }))
    expect(result.trackpoints[0].cadenceSpm).toBe(170)
  })

  it('resolves Sport="Biking" to the cycling sport', () => {
    const result = parseTcx(tcx({ sport: 'Biking', trackpointsXml: bikeTrackpoint }))
    expect(result.sport).toBe('cycling')
  })

  it('reads the plain top-level Cadence element undoubled for cycling (pedal rpm, not strides)', () => {
    const result = parseTcx(tcx({ sport: 'Biking', trackpointsXml: bikeTrackpoint }))
    expect(result.trackpoints[0].cadenceSpm).toBe(85)
  })

  it('prefers RunCadence over a stray top-level Cadence element for a running activity', () => {
    const both = `
      <Trackpoint>
        <Time>2026-01-01T00:00:00.000Z</Time>
        <DistanceMeters>0.0</DistanceMeters>
        <Cadence>60</Cadence>
        <Extensions><ns3:TPX><ns3:RunCadence>85</ns3:RunCadence></ns3:TPX></Extensions>
      </Trackpoint>`
    const result = parseTcx(tcx({ sport: 'Running', trackpointsXml: both }))
    expect(result.trackpoints[0].cadenceSpm).toBe(170)
  })

  it('leaves watts null when Extensions has no TPX Watts (normal — most files lack a power meter)', () => {
    const result = parseTcx(tcx({ trackpointsXml: fullTrackpoint }))
    expect(result.trackpoints[0].watts).toBeNull()
  })

  it('reads watts when present', () => {
    const withWatts = `
      <Trackpoint>
        <Time>2026-01-01T00:00:00.000Z</Time>
        <DistanceMeters>0.0</DistanceMeters>
        <Extensions><ns3:TPX><ns3:Watts>250</ns3:Watts></ns3:TPX></Extensions>
      </Trackpoint>`
    const result = parseTcx(tcx({ trackpointsXml: withWatts }))
    expect(result.trackpoints[0].watts).toBe(250)
  })

  it('flattens trackpoints across multiple laps into one array', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-01-01T00:00:00.000Z</Id>
      <Lap StartTime="2026-01-01T00:00:00.000Z"><Track>${fullTrackpoint}</Track></Lap>
      <Lap StartTime="2026-01-01T00:10:00.000Z"><Track>${fullTrackpoint}</Track></Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`
    const result = parseTcx(xml)
    expect(result.trackpoints).toHaveLength(2)
  })

  it('keeps a time-only trackpoint (filtering "nothing but time" is normalizeActivity\'s job, not this layer\'s)', () => {
    const timeOnly = '<Trackpoint><Time>2026-01-01T00:00:05.000Z</Time></Trackpoint>'
    const result = parseTcx(tcx({ trackpointsXml: timeOnly }))
    expect(result.trackpoints).toHaveLength(1)
  })

  it('drops a trackpoint with no Time element at all — it cannot be placed on any axis', () => {
    const noTime = '<Trackpoint><DistanceMeters>5</DistanceMeters></Trackpoint>'
    const result = parseTcx(tcx({ trackpointsXml: `${noTime}${fullTrackpoint}` }))
    expect(result.trackpoints).toHaveLength(1)
  })

  it('throws a clear error for an unsupported sport', () => {
    expect(() => parseTcx(tcx({ sport: 'Other', trackpointsXml: fullTrackpoint }))).toThrow(/running.*cycling/i)
  })

  it('throws a clear error for invalid XML', () => {
    expect(() => parseTcx('<TrainingCenterDatabase><unclosed></TrainingCenterDatabase>')).toThrow()
  })

  it('throws a clear error when there is no Activity element', () => {
    expect(() =>
      parseTcx(
        `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities/></TrainingCenterDatabase>`,
      ),
    ).toThrow(/Activity/)
  })

  it('throws a clear error when the file has no trackpoints at all', () => {
    expect(() => parseTcx(tcx({ trackpointsXml: '' }))).toThrow(/trackpoint/i)
  })
})
