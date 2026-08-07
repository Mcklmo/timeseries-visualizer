import { describe, it, expect } from 'vitest'
import { TcxActivitySource } from './TcxActivitySource.js'

const validTcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-01-01T00:00:00.000Z</Id>
      <Lap StartTime="2026-01-01T00:00:00.000Z">
        <Track>
          <Trackpoint>
            <Time>2026-01-01T00:00:00.000Z</Time>
            <DistanceMeters>0.0</DistanceMeters>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
            <Extensions><ns3:TPX><ns3:Speed>3.0</ns3:Speed><ns3:RunCadence>85</ns3:RunCadence></ns3:TPX></Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-01-01T00:00:10.000Z</Time>
            <DistanceMeters>30.0</DistanceMeters>
            <HeartRateBpm><Value>125</Value></HeartRateBpm>
            <Extensions><ns3:TPX><ns3:Speed>3.0</ns3:Speed><ns3:RunCadence>86</ns3:RunCadence></ns3:TPX></Extensions>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

function fileOf(text, name = 'run.tcx') {
  return new File([text], name, { type: 'application/xml' })
}

describe('TcxActivitySource', () => {
  it('has kind "tcx"', () => {
    expect(new TcxActivitySource().kind).toBe('tcx')
  })

  it('loads a file ref through parseTcx + normalizeActivity into a full Activity', async () => {
    const source = new TcxActivitySource()
    const activity = await source.load({ type: 'file', file: fileOf(validTcx) })

    expect(activity.sport).toBe('running')
    expect(activity.samples).toHaveLength(2)
    expect(activity.totalDistance).toBe(30)
    expect(activity.availableMetrics).toEqual(expect.arrayContaining(['pace', 'heartRate', 'cadence']))
    expect(activity.availableMetrics).not.toContain('power')
  })

  it('rejects a non-file ref', async () => {
    const source = new TcxActivitySource()
    await expect(source.load({ type: 'id', id: 'sample' })).rejects.toThrow(/file/i)
  })

  it('rejects with the parser\'s specific error message for a malformed file', async () => {
    const source = new TcxActivitySource()
    await expect(source.load({ type: 'file', file: fileOf('not xml at all <<<') })).rejects.toThrow()
  })
})
