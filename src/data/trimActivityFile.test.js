// Dispatch only — each trimmer's own suite proves what it does to a document.
// What this asserts is that real bytes of all three formats reach the right one
// and come back naming themselves, which is what lets the caller title a
// download it never saw a filename for.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { trimActivityFile } from './trimActivityFile.js'
import { detectActivityFormat } from './fileFormat.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const bytesOf = (name) => new Uint8Array(readFileSync(join(FIXTURE_DIR, name)))

// Minutes 10-20 of Garmin activity 23870166877, the window every
// *.realGarminFixture suite pins.
const T0 = new Date('2026-08-06T04:40:38.000Z')
const window = {
  from: new Date(T0.getTime() + 600 * 1000),
  to: new Date(T0.getTime() + 1200 * 1000),
}

describe('trimActivityFile', () => {
  it('routes real FIT bytes to trimFit and reports the fit extension', async () => {
    const result = await trimActivityFile(bytesOf('23870166877_ACTIVITY.fit'), window)

    expect(result.extension).toBe('fit')
    expect(detectActivityFormat(result.bytes)).toBe('fit')
  })

  it('routes real TCX bytes to trimTcx and reports the tcx extension', async () => {
    const result = await trimActivityFile(bytesOf('activity_23870166877.tcx'), window)

    expect(result.extension).toBe('tcx')
    expect(detectActivityFormat(result.bytes)).toBe('tcx')
  })

  it('routes real GPX bytes to trimGpx and reports the gpx extension', async () => {
    const result = await trimActivityFile(bytesOf('activity_23870166877.gpx'), window)

    expect(result.extension).toBe('gpx')
    expect(detectActivityFormat(result.bytes)).toBe('gpx')
  })

  it('round-trips XML through UTF-8 without losing the declaration', async () => {
    const result = await trimActivityFile(bytesOf('activity_23870166877.tcx'), window)
    // The codec is this module's, so this is the one place the encode side of
    // the XMLSerializer prolog finding is observable as bytes.
    expect(new TextDecoder().decode(result.bytes).startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('refuses bytes that are no format this app can parse', async () => {
    await expect(trimActivityFile(new TextEncoder().encode('just some text'), window)).rejects.toThrow(
      /isn't a FIT, TCX or GPX recording/,
    )
  })
})
