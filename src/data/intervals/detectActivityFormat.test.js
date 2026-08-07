import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectActivityFormat, gunzipIfNeeded } from './detectActivityFormat.js'

const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const encoder = new TextEncoder()

/** A 14-byte FIT header: the `.FIT` magic sits at offset 8, not offset 0. */
function fitHeader(magic = '.FIT') {
  const bytes = new Uint8Array(14)
  bytes[0] = 14 // header size
  bytes.set(encoder.encode(magic), 8)
  return bytes
}

// CompressionStream mirrors the DecompressionStream the module uses, and for
// the same reason goes through Response rather than Blob — see the module
// header for why mixing jsdom's Blob with Node's streams breaks.
async function gzip(bytes) {
  const compressed = await new Response(
    new Response(bytes).body.pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  return new Uint8Array(compressed)
}

describe('detectActivityFormat', () => {
  it('reads the .FIT magic at offset 8, not at the start of the buffer', () => {
    expect(detectActivityFormat(fitHeader())).toBe('fit')
    // the same four bytes at offset 0 are not a FIT file
    expect(detectActivityFormat(encoder.encode('.FITxxxxxxxxxx'))).toBeNull()
  })

  it('recognises TCX and GPX by their root element', () => {
    expect(detectActivityFormat(encoder.encode('<TrainingCenterDatabase xmlns="..."></x>'))).toBe('tcx')
    expect(detectActivityFormat(encoder.encode('<gpx version="1.1"></gpx>'))).toBe('gpx')
  })

  it('looks past a BOM, an XML prolog, comments and whitespace to find the root element', () => {
    const tcx = '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported by something -->\n\n<TrainingCenterDatabase>'
    expect(detectActivityFormat(encoder.encode(tcx))).toBe('tcx')

    const gpx = '<?xml version="1.0"?><!DOCTYPE gpx SYSTEM "gpx.dtd"><gpx version="1.0">'
    expect(detectActivityFormat(encoder.encode(gpx))).toBe('gpx')
  })

  it('ignores a namespace prefix on the root element', () => {
    expect(detectActivityFormat(encoder.encode('<ns0:gpx xmlns:ns0="..."/>'))).toBe('gpx')
  })

  it('returns null for XML that is neither, for junk, and for an empty buffer', () => {
    expect(detectActivityFormat(encoder.encode('<kml xmlns="http://www.opengis.net/kml/2.2">'))).toBeNull()
    expect(detectActivityFormat(encoder.encode('not a file at all'))).toBeNull()
    expect(detectActivityFormat(new Uint8Array(0))).toBeNull()
  })

  it('returns null for a buffer truncated before the magic can be read', () => {
    expect(detectActivityFormat(fitHeader().subarray(0, 10))).toBeNull()
  })

  // The bytes must decide, because intervals.icu's `file_type` is a hint from
  // whatever synced the activity and Content-Disposition is unreadable across
  // CORS — so these are the two files the app already ships, unlabelled.
  it('agrees with the real fixtures', () => {
    const fit = readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit'))
    const tcx = readFileSync(join(FIXTURE_DIR, 'activity_23870166877.tcx'))
    const gpx = readFileSync(join(FIXTURE_DIR, 'activity_23870166877.gpx'))

    expect(detectActivityFormat(new Uint8Array(fit))).toBe('fit')
    expect(detectActivityFormat(new Uint8Array(tcx))).toBe('tcx')
    expect(detectActivityFormat(new Uint8Array(gpx))).toBe('gpx')
  })
})

describe('gunzipIfNeeded', () => {
  it('round-trips a gzipped fixture back to detectable bytes', async () => {
    const fit = new Uint8Array(readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit')))
    const compressed = await gzip(fit)

    // proves the fixture really was compressed, i.e. the round trip is real
    expect(compressed[0]).toBe(0x1f)
    expect(compressed[1]).toBe(0x8b)
    expect(detectActivityFormat(compressed)).toBeNull()

    const inflated = await gunzipIfNeeded(compressed)
    expect(inflated).toEqual(fit)
    expect(detectActivityFormat(inflated)).toBe('fit')
  })

  // Whether /file arrives as Content-Encoding: gzip (auto-inflated by the
  // browser) or as opaque gzip bytes is unverified, so both must work.
  it('passes plain bytes through untouched', async () => {
    const plain = encoder.encode('<gpx version="1.1"/>')
    await expect(gunzipIfNeeded(plain)).resolves.toBe(plain)
  })

  it('passes a buffer too short to carry the magic through untouched', async () => {
    const tiny = new Uint8Array([0x1f])
    await expect(gunzipIfNeeded(tiny)).resolves.toBe(tiny)
  })
})
