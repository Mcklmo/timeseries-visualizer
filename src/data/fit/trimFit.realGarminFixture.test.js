// The test that actually proves the trim is honest, and the fifth suite pinned
// to fixtures/23870166877_ACTIVITY.fit (Garmin activity id 23870166877).
//
// It exports minutes 10–20 of that file and feeds the result back through the
// app's OWN read path — parseFit -> normalizeActivity — so the assertions are
// about what a user would see after dropping the downloaded file back in.
//
// ⚠️ The cross-check that makes this worth having: the 6:10/km below is
// independently the value src/stats/statsBasis.realGarminFixture.test.js
// asserts for the SAME window of the SAME file, reached by a completely
// different code path (zoom the parent activity and read the chips). Export →
// re-import → the same number means the trim neither dropped nor invented
// anything. That agreement is invisible to a later reader otherwise.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Decoder, Stream } from '@garmin/fitsdk'
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { formatPace } from '../../domain/units.js'
import { parseFit } from './parseFit.js'
import { trimFit } from './trimFit.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const fitBytes = readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit'))
const sourceBuffer = fitBytes.buffer.slice(fitBytes.byteOffset, fitBytes.byteOffset + fitBytes.byteLength)

const WINDOW_START_S = 600
const WINDOW_END_S = 1200

function decode(buffer) {
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer))
  const { messages, errors } = decoder.read({
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
  })
  return { decoder, messages, errors }
}

/** ArrayBuffer view of a Uint8Array, without copying the whole file again. */
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const source = decode(sourceBuffer)
const firstRecordTime = source.messages.recordMesgs[0].timestamp
const window = {
  from: new Date(firstRecordTime.getTime() + WINDOW_START_S * 1000),
  to: new Date(firstRecordTime.getTime() + WINDOW_END_S * 1000),
}

const trimmedBytes = await trimFit(sourceBuffer, window)
const trimmedBuffer = toArrayBuffer(trimmedBytes)

describe('trimFit against the real Garmin export (fixtures/23870166877_ACTIVITY.fit)', () => {
  it('keeps exactly the records inside the window, both ends inclusive', () => {
    expect(source.messages.recordMesgs).toHaveLength(1801)
    // 601, not 600: one record per second, and both boundary seconds are kept.
    expect(decode(trimmedBuffer).messages.recordMesgs).toHaveLength(601)
  })

  it('writes a structurally valid FIT file (header, CRCs, no decode errors)', () => {
    // checkIntegrity on a FRESH decoder: it re-reads the header and walks the
    // whole buffer to verify the CRCs, which a decoder that has already run
    // read() cannot do from its consumed stream.
    expect(new Decoder(Stream.fromArrayBuffer(trimmedBuffer)).checkIntegrity()).toBe(true)
    expect(decode(trimmedBuffer).errors).toEqual([])
  })

  it('re-imports through the app\'s own read path with the window\'s own totals', async () => {
    const activity = normalizeActivity(await parseFit(trimmedBuffer))

    expect(activity.totalDistance).toBeCloseTo(1622.83, 2)
    expect(activity.totalTime).toBe(WINDOW_END_S - WINDOW_START_S)
    // The rebase: FIT distance is cumulative from the parent's start, so
    // without it this sample opens at ~1481 m and the total reads 3104 m.
    expect(activity.samples[0].d).toBe(0)
  })

  it('reports the same 6:10/km the zoomed parent activity reports for this window', async () => {
    const activity = normalizeActivity(await parseFit(trimmedBuffer))
    const avgPaceSecPerKm = activity.totalMovingTime / (activity.totalDistance / 1000)
    expect(formatPace(avgPaceSecPerKm)).toBe('6:10')
  })

  it('carries the Stryd developer-field power across', async () => {
    const activity = normalizeActivity(await parseFit(trimmedBuffer))
    expect(activity.availableMetrics).toContain('power')

    const watts = activity.samples.map((s) => s.power).filter((v) => v != null)
    expect(watts).toHaveLength(601)
    const avgWatts = watts.reduce((sum, w) => sum + w, 0) / watts.length
    expect(avgWatts).toBeCloseTo(225, 0)
  })

  it('carries the sport across, so the re-imported file is still a run', async () => {
    const activity = normalizeActivity(await parseFit(trimmedBuffer))
    expect(activity.sport).toBe('running')
    expect(activity.name).toBe('Morning Run')
  })
})
