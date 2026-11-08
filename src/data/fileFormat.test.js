import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectActivityFormat, inflateIfNeeded, InflateLimitError, MAX_INFLATED_BYTES } from './fileFormat.js'

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

describe('inflateIfNeeded', () => {
  it('round-trips a gzipped fixture back to detectable bytes', async () => {
    const fit = new Uint8Array(readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit')))
    const compressed = await gzip(fit)

    // proves the fixture really was compressed, i.e. the round trip is real
    expect(compressed[0]).toBe(0x1f)
    expect(compressed[1]).toBe(0x8b)
    expect(detectActivityFormat(compressed)).toBeNull()

    const inflated = await inflateIfNeeded(compressed)
    expect(inflated).toEqual(fit)
    expect(detectActivityFormat(inflated)).toBe('fit')
  })

  // Whether /file arrives as Content-Encoding: gzip (auto-inflated by the
  // browser) or as opaque gzip bytes is unverified, so both must work.
  it('passes plain bytes through untouched', async () => {
    const plain = encoder.encode('<gpx version="1.1"/>')
    await expect(inflateIfNeeded(plain)).resolves.toBe(plain)
  })

  it('passes a buffer too short to carry the magic through untouched', async () => {
    const tiny = new Uint8Array([0x1f])
    await expect(inflateIfNeeded(tiny)).resolves.toBe(tiny)
  })
})

describe('inflateIfNeeded on a ZIP', () => {
  // Garmin's "Export original" ZIP: one deflated entry, data-descriptor flag
  // set, so the local header's compressed size is 0.
  it("opens Garmin's original-file ZIP from its central directory", async () => {
    const zip = new Uint8Array(readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.zip')))
    const fit = new Uint8Array(readFileSync(join(FIXTURE_DIR, '23870166877_ACTIVITY.fit')))
    expect(zip[6] & 0x08).toBe(0x08)
    expect(zip.subarray(18, 22)).toEqual(new Uint8Array(4))

    // Buffer.compare, not toEqual: a failing toEqual on 200 KB arrays builds a diff for minutes.
    expect(Buffer.compare(await inflateIfNeeded(zip), fit)).toBe(0)
  })
})

async function deflateRaw(bytes) {
  return new Uint8Array(
    await new Response(new Response(bytes).body.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
  )
}

/**
 * A minimal ZIP, local headers zeroed like Garmin's. CRCs are left 0: the
 * reader never checks them.
 * @param {{name: string, data: Uint8Array, method: 0|8, size: number}[]} entries
 */
function zipOf(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const { name, data, method, size } of entries) {
    const nameBytes = encoder.encode(name)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(6, 0x08, true)
    local.setUint16(8, method, true)
    local.setUint16(26, nameBytes.length, true)
    parts.push(new Uint8Array(local.buffer), nameBytes, data)

    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(10, method, true)
    header.setUint32(20, data.length, true)
    header.setUint32(24, size, true)
    header.setUint16(28, nameBytes.length, true)
    header.setUint32(42, offset, true)
    central.push(new Uint8Array(header.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Uint8Array(Buffer.concat([...parts, ...central, new Uint8Array(end.buffer)]))
}

describe('inflateIfNeeded on a hand-built ZIP', () => {
  const gpx = encoder.encode('<gpx version="1.1"></gpx>')

  it('skips entries that are not activities and reads a stored one', async () => {
    const readme = encoder.encode('hello')
    const zip = zipOf([
      { name: 'readme.txt', data: await deflateRaw(readme), method: 8, size: readme.length },
      { name: 'track.gpx', data: gpx, method: 0, size: gpx.length },
    ])
    expect(new TextDecoder().decode(await inflateIfNeeded(zip))).toBe('<gpx version="1.1"></gpx>')
  })

  it('returns a ZIP with no activity in it unchanged', async () => {
    const readme = encoder.encode('hello')
    const zip = zipOf([{ name: 'readme.txt', data: readme, method: 0, size: readme.length }])
    expect(await inflateIfNeeded(zip)).toBe(zip)
  })
})

// 64 MiB of real inflating; the default 5 s is too tight on a busy machine.
describe('the 64 MiB inflate cap', { timeout: 30_000 }, () => {
  const bomb = new Uint8Array(MAX_INFLATED_BYTES + 1)
  // Caught to a value so a failure prints `null`, not 64 MiB of zeros.
  const errorOf = (promise) => promise.then(() => null, (error) => error)

  it('stops a gzip bomb', async () => {
    expect(await errorOf(inflateIfNeeded(await gzip(bomb)))).toBeInstanceOf(InflateLimitError)
  })

  it('stops a ZIP bomb', async () => {
    const zip = zipOf([{ name: 'a.fit', data: await deflateRaw(bomb), method: 8, size: bomb.length }])
    expect((await errorOf(inflateIfNeeded(zip)))?.message).toBe("This link's activity couldn't be read.")
  })
})
