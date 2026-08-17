import { describe, it, expect } from 'vitest'
import { Decoder, Encoder, Profile, Stream } from '@garmin/fitsdk'
import { trimFit } from './trimFit.js'

const T0 = new Date('2026-01-01T00:00:00.000Z')
const at = (seconds) => new Date(T0.getTime() + seconds * 1000)

// The same synthetic-FIT builder parseFit.test.js uses, in its other direction:
// a minimal file assembled with a real Encoder, so these tests stay independent
// of the large Garmin fixture (that one is trimFit.realGarminFixture.test.js's
// job). `session` is spread over the defaults so a test can add the fields it
// wants to watch survive — or not survive — the trim.
function fit({ includeSession = true, session = {}, sport, records = [] } = {}) {
  const encoder = new Encoder()

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    timeCreated: T0,
  })

  if (sport != null) {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.SPORT, sport })
  }
  if (includeSession) {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.SESSION, sport: 'running', ...session })
  }

  records.forEach((record) => {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.RECORD, ...record })
  })

  const bytes = encoder.close()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

// One record per second, walking 3 m/s, so distance is a clean 3× the offset.
function walk(count, extra = () => ({})) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: at(i),
    distance: i * 3,
    enhancedSpeed: 3,
    ...extra(i),
  }))
}

function decode(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const { messages, errors } = new Decoder(Stream.fromArrayBuffer(buffer)).read({
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
  })
  expect(errors).toEqual([])
  return messages
}

const trimTo = async (buffer, fromS, toS) => decode(await trimFit(buffer, { from: at(fromS), to: at(toS) }))

describe('trimFit', () => {
  it('keeps only the records inside the window, with both boundaries included', async () => {
    const messages = await trimTo(fit({ records: walk(10) }), 3, 6)
    expect(messages.recordMesgs.map((r) => r.timestamp)).toEqual([at(3), at(4), at(5), at(6)])
  })

  it('re-bases distance so the first kept record reads 0', async () => {
    const messages = await trimTo(fit({ records: walk(10) }), 3, 6)
    // Without the rebase these would be 9, 12, 15, 18 — cumulative from the
    // parent activity's start, which makes the trimmed file report roughly
    // double its true distance on re-import.
    expect(messages.recordMesgs.map((r) => r.distance)).toEqual([0, 3, 6, 9])
  })

  it('leaves records with no distance field untouched by the rebase', async () => {
    const records = walk(6).map((r, i) => (i === 4 ? { timestamp: r.timestamp, enhancedSpeed: 3 } : r))
    const messages = await trimTo(fit({ records }), 2, 5)
    expect(messages.recordMesgs.map((r) => r.distance)).toEqual([0, 3, undefined, 9])
  })

  it('recomputes the session summary from the windowed records alone', async () => {
    const records = walk(20, (i) => ({ heartRate: 140 + (i % 4), cadence: 80 + (i % 3) }))
    const [session] = (await trimTo(fit({ records }), 5, 15)).sessionMesgs

    expect(session.totalDistance).toBeCloseTo(30, 5) // 10 s at 3 m/s
    expect(session.totalElapsedTime).toBe(10)
    expect(session.totalTimerTime).toBe(10)
    expect(session.enhancedAvgSpeed).toBeCloseTo(3, 5)
    // heartRates over i=5..15 are 141,142,143,140,… — mean 141.55, rounded.
    expect(session.avgHeartRate).toBe(142)
    expect(session.maxHeartRate).toBe(143)
    expect(session.maxCadence).toBe(82)
    expect(session.startTime).toEqual(at(5))
    expect(session.timestamp).toEqual(at(15))
  })

  it('writes a matching lap and a single activity message, so the file stands alone', async () => {
    const messages = await trimTo(fit({ records: walk(10) }), 2, 8)
    expect(messages.lapMesgs).toHaveLength(1)
    expect(messages.lapMesgs[0].totalElapsedTime).toBe(6)
    expect(messages.activityMesgs[0].numSessions).toBe(1)
    expect(messages.activityMesgs[0].totalTimerTime).toBe(6)
    // One timer/start at the first kept record, one timer/stopAll at the last.
    expect(messages.eventMesgs.map((e) => e.eventType)).toEqual(['start', 'stopAll'])
  })

  it('carries sport and sportProfileName across, keeping the re-import a labelled run', async () => {
    const buffer = fit({ session: { sport: 'running', sportProfileName: 'Trail Run' }, records: walk(10) })
    const [session] = (await trimTo(buffer, 2, 8)).sessionMesgs
    expect(session.sport).toBe('running')
    expect(session.sportProfileName).toBe('Trail Run')
  })

  it('falls back to the sport message when the file has no session at all', async () => {
    const buffer = fit({ includeSession: false, sport: 'cycling', records: walk(10) })
    const [session] = (await trimTo(buffer, 2, 8)).sessionMesgs
    expect(session.sport).toBe('cycling')
  })

  it('omits a channel the file never recorded rather than writing Math.max of nothing', async () => {
    const [session] = (await trimTo(fit({ records: walk(10) }), 2, 8)).sessionMesgs
    // -Infinity here would encode as a garbage integer that reads as a real
    // heart rate on whatever imports the file next.
    expect(session.avgHeartRate).toBeUndefined()
    expect(session.maxHeartRate).toBeUndefined()
    expect(session.avgCadence).toBeUndefined()
  })

  it('omits calories rather than prorating them — a scaled calorie count is a fabricated number', async () => {
    const buffer = fit({ session: { totalCalories: 500 }, records: walk(10) })
    const [session] = (await trimTo(buffer, 2, 8)).sessionMesgs
    expect(session.totalCalories).toBeUndefined()
  })

  it('throws a clear error when the window holds fewer than two records', async () => {
    const buffer = fit({ records: walk(10) })
    await expect(trimFit(buffer, { from: at(4), to: at(4) })).rejects.toThrow(/window/i)
    await expect(trimFit(buffer, { from: at(50), to: at(60) })).rejects.toThrow(/window/i)
  })

  it('throws a clear error for non-FIT input', async () => {
    await expect(trimFit(new ArrayBuffer(10), { from: at(0), to: at(9) })).rejects.toThrow(/valid FIT file/i)
  })
})
