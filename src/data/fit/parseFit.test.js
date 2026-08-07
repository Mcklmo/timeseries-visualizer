import { describe, it, expect } from 'vitest'
import { Encoder, Profile } from '@garmin/fitsdk'
import { parseFit } from './parseFit.js'

// Stryd's registered FIT developer app id — see ARCHITECTURE.md's FIT notes.
const STRYD_APP_ID = [0x18, 0xfb, 0x2c, 0xf0, 0x1a, 0x4b, 0x43, 0x0d, 0xad, 0x66, 0x98, 0x8c, 0x84, 0x74, 0x21, 0xf4]

const developerDataIdMesg = { developerDataIndex: 0, applicationId: STRYD_APP_ID }
const powerFieldDescriptionMesg = {
  developerDataIndex: 0,
  fieldDefinitionNumber: 0,
  fitBaseTypeId: 132, // uint16
  fieldName: 'Power',
  units: 'watts',
  nativeMesgNum: Profile.MesgNum.RECORD,
  nativeFieldNum: 7,
}

// Builds a minimal synthetic FIT file, the binary-format analogue of
// parseTcx.test.js's `tcx()` XML-string builder — keeps these tests
// independent of the large real fixture. `withPowerDevField` registers a
// Stryd-shaped developer field (mirroring record's standard power field 7)
// so tests can exercise the developer-field resolution path in parseFit.js.
function fit({
  sport = 'running',
  includeSession = true,
  withPowerDevField = false,
  records = [],
} = {}) {
  const encoder = new Encoder()
  if (withPowerDevField) {
    encoder.addDeveloperField(0, developerDataIdMesg, powerFieldDescriptionMesg)
  }

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    timeCreated: new Date('2026-01-01T00:00:00.000Z'),
  })

  if (withPowerDevField) {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.DEVELOPER_DATA_ID, ...developerDataIdMesg })
    encoder.writeMesg({ mesgNum: Profile.MesgNum.FIELD_DESCRIPTION, ...powerFieldDescriptionMesg })
  }

  if (includeSession) {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.SESSION, sport })
  }

  records.forEach((record) => {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.RECORD, ...record })
  })

  const bytes = encoder.close()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const LAT_DEGREES = 57.01
const LON_DEGREES = 9.97
const semicircles = (degrees) => Math.round(degrees * (2 ** 31 / 180))

const fullRecord = {
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  positionLat: semicircles(LAT_DEGREES),
  positionLong: semicircles(LON_DEGREES),
  enhancedAltitude: 12.6,
  distance: 0,
  heartRate: 120,
  cadence: 85,
  enhancedSpeed: 3.1,
}

describe('parseFit', () => {
  it('extracts sport and field-mapped trackpoints', async () => {
    const result = await parseFit(fit({ records: [fullRecord] }))
    expect(result.sport).toBe('running')
    expect(result.trackpoints).toHaveLength(1)

    const [p] = result.trackpoints
    expect(p.time).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(p.distanceMeters).toBe(0)
    expect(p.altitudeMeters).toBeCloseTo(12.6, 6)
    expect(p.heartRateBpm).toBe(120)
    expect(p.lat).toBeCloseTo(LAT_DEGREES, 5)
    expect(p.lon).toBeCloseTo(LON_DEGREES, 5)
    expect(p.speedMps).toBe(3.1)
  })

  it('doubles the per-leg cadence into steps/min', async () => {
    const result = await parseFit(fit({ records: [fullRecord] }))
    expect(result.trackpoints[0].cadenceSpm).toBe(170)
  })

  it('resolves a cycling session sport and passes cadence through undoubled (already pedal rpm)', async () => {
    const result = await parseFit(fit({ sport: 'cycling', records: [fullRecord] }))
    expect(result.sport).toBe('cycling')
    expect(result.trackpoints[0].cadenceSpm).toBe(85)
  })

  it('leaves watts null when there is no power field at all (normal — most files lack a power meter)', async () => {
    const result = await parseFit(fit({ records: [fullRecord] }))
    expect(result.trackpoints[0].watts).toBeNull()
  })

  it('resolves watts from a Stryd-shaped developer field (the whole point of this feature)', async () => {
    const withPower = { ...fullRecord, developerFields: { 0: 250 } }
    const result = await parseFit(fit({ withPowerDevField: true, records: [withPower] }))
    expect(result.trackpoints[0].watts).toBe(250)
  })

  it('prefers the standard power field over a developer field when both are present', async () => {
    const withBoth = { ...fullRecord, power: 300, developerFields: { 0: 250 } }
    const result = await parseFit(fit({ withPowerDevField: true, records: [withBoth] }))
    expect(result.trackpoints[0].watts).toBe(300)
  })

  it('keeps a time-only trackpoint (filtering "nothing but time" is normalizeActivity\'s job, not this layer\'s)', async () => {
    const timeOnly = { timestamp: new Date('2026-01-01T00:00:05.000Z') }
    const result = await parseFit(fit({ records: [timeOnly] }))
    expect(result.trackpoints).toHaveLength(1)
  })

  it('drops a record with no timestamp — it cannot be placed on any axis', async () => {
    const noTime = { distance: 5 }
    const result = await parseFit(fit({ records: [noTime, fullRecord] }))
    expect(result.trackpoints).toHaveLength(1)
  })

  it('treats a missing session message as running rather than blocking', async () => {
    const result = await parseFit(fit({ includeSession: false, records: [fullRecord] }))
    expect(result.sport).toBe('running')
  })

  it('throws a clear error for an unsupported sport', async () => {
    await expect(parseFit(fit({ sport: 'swimming', records: [fullRecord] }))).rejects.toThrow(/running.*cycling/i)
  })

  it('throws a clear error for invalid/non-FIT input', async () => {
    await expect(parseFit(new ArrayBuffer(10))).rejects.toThrow(/valid FIT file/i)
  })

  it('throws a clear error when the file has no trackpoints at all', async () => {
    const noTime = { distance: 5 }
    await expect(parseFit(fit({ records: [noTime] }))).rejects.toThrow(/trackpoint/i)
  })
})
