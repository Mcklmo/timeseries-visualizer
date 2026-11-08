// Which parser does this buffer want, after unpacking any gzip or ZIP around it?
//
// It lives at the top of `data/` rather than under one provider's folder
// because nothing in it is that provider's: it names no wire field, and any
// network source that hands back an original uploaded file needs the same
// answer. intervals.icu is simply the first caller.
//
// **The bytes decide, not whatever the provider called the file.** Three
// reasons, all first learned on the intervals.icu path: the browser cannot
// read Content-Disposition across that CORS boundary (see intervalsApi.js), so
// there is no filename to take an extension from; a `file_type` field is
// whatever the syncing service claimed and can be stale or simply wrong; and
// sniffing needs no second API call. It also keeps ActivityRef exactly as
// ARCHITECTURE.md §5 defines it, which matters because ErrorState's "Try
// again" replays a ref carrying no metadata at all. A declared type is still
// useful as a pre-flight hint in a picker — it greys out rows that can't work
// before a request is made — but it is never the authority here.

const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

// The FIT header is 14 bytes with the ASCII magic at offset 8 — not at the
// start, which is where a naive sniff looks and finds nothing.
const FIT_MAGIC = '.FIT'
const FIT_MAGIC_OFFSET = 8

// Enough to clear a BOM, a prolog, a DOCTYPE and a generous comment banner
// without decoding a multi-megabyte track just to read its first tag.
const XML_SNIFF_BYTES = 8192

const FORMAT_BY_ROOT_ELEMENT = { TrainingCenterDatabase: 'tcx', gpx: 'gpx' }

const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_END_OF_CENTRAL_DIR = 0x06054b50
const ZIP_END_OF_CENTRAL_DIR_BYTES = 22
const ZIP_MAX_COMMENT_BYTES = 0xffff
const ZIP_STORED = 0
const ZIP_DEFLATE = 8

// A crafted file link is an easy way to deliver a decompression bomb; see
// doc/file-link.md.
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024

export const UNREADABLE_LINK_MESSAGE = "This link's activity couldn't be read."

/** Inflating would pass MAX_INFLATED_BYTES. */
export class InflateLimitError extends Error {
  constructor() {
    super(UNREADABLE_LINK_MESSAGE)
    this.name = 'InflateLimitError'
  }
}

function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
}

function isZip(bytes) {
  return bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === ZIP_LOCAL_HEADER
}

/**
 * Inflates a gzip stream (intervals.icu's /file endpoint returns one) or picks
 * the first activity file out of a ZIP (Garmin's original-file export).
 * Anything else, including a ZIP with no activity in it, comes back unchanged.
 *
 * Checks the magic bytes rather than a header: it is unverified whether the
 * response arrives as `Content-Encoding: gzip` (the browser auto-inflates,
 * and we get plain bytes) or as an opaque gzip payload. Sniffing handles both
 * without caring which.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 * @throws {InflateLimitError} past MAX_INFLATED_BYTES; any other error means corrupt input
 */
export async function inflateIfNeeded(bytes) {
  if (isGzip(bytes)) return inflateCapped(bytes, 'gzip', MAX_INFLATED_BYTES)
  if (isZip(bytes)) return (await firstActivityInZip(bytes)) ?? bytes
  return bytes
}

// Sizes and offsets come from the central directory: Garmin's ZIPs set the
// data-descriptor flag, so their local headers say size 0.
// Field offsets are PKWARE APPNOTE.TXT §4.3.7 (local header), §4.3.12 (central
// directory) and §4.3.16 (end of central directory).
// ponytail: no ZIP64; an activity file is nowhere near 4 GiB.
async function firstActivityInZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEndOfCentralDirectory(view)
  const entryCount = view.getUint16(end + 10, true)
  let entry = view.getUint32(end + 16, true)
  let budget = MAX_INFLATED_BYTES

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(entry, true) !== ZIP_CENTRAL_HEADER) throw new Error('corrupt ZIP')
    const method = view.getUint16(entry + 10, true)
    const compressedSize = view.getUint32(entry + 20, true)
    const localHeader = view.getUint32(entry + 42, true)
    entry += 46 + view.getUint16(entry + 28, true) + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true)

    const dataStart = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true)
    const data = bytes.subarray(dataStart, dataStart + compressedSize)
    let inflated
    if (method === ZIP_STORED) inflated = data
    else if (method === ZIP_DEFLATE) inflated = await inflateCapped(data, 'deflate-raw', budget)
    else continue
    // One budget for the whole archive, so many small bombs can't add up.
    budget -= inflated.length
    if (detectActivityFormat(inflated)) return inflated
  }
  return null
}

function findEndOfCentralDirectory(view) {
  const last = view.byteLength - ZIP_END_OF_CENTRAL_DIR_BYTES
  for (let i = last; i >= Math.max(0, last - ZIP_MAX_COMMENT_BYTES); i--) {
    if (view.getUint32(i, true) === ZIP_END_OF_CENTRAL_DIR) return i
  }
  throw new Error('corrupt ZIP')
}

/**
 * Inflate with a running byte cap, chunk by chunk: `arrayBuffer()` on the
 * whole stream would hand a 40-byte bomb however much memory it asks for
 * before anything could refuse it.
 *
 * **Response, never Blob.** Under jsdom, `Blob` is jsdom's while
 * `DecompressionStream` and `Response` are Node's — jsdom implements neither
 * of the latter two, so they survive on globalThis. Feeding a jsdom Blob into
 * a Node stream breaks; going through `Response` keeps everything on one side.
 *
 * @param {Uint8Array} bytes
 * @param {'gzip'|'deflate-raw'} format
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array>}
 * @throws {InflateLimitError} past maxBytes; a corrupt stream rejects out of `read()`
 */
export async function inflateCapped(bytes, format, maxBytes) {
  const reader = new Response(bytes).body.pipeThrough(new DecompressionStream(format)).getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new InflateLimitError()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function hasFitMagic(bytes) {
  if (bytes.length < FIT_MAGIC_OFFSET + FIT_MAGIC.length) return false
  for (let i = 0; i < FIT_MAGIC.length; i++) {
    if (bytes[FIT_MAGIC_OFFSET + i] !== FIT_MAGIC.charCodeAt(i)) return false
  }
  return true
}

// Everything an exporter may legally put before the root element: a BOM, an
// XML declaration or processing instruction, a DOCTYPE, comments, whitespace
// — in any order and any number. Peeled off one at a time until the text
// stops shrinking, which is either the root element or something that was
// never XML.
function rootElementNameOf(text) {
  let rest = text.replace(/^﻿/, '')
  for (;;) {
    const before = rest
    rest = rest
      .replace(/^\s+/, '')
      .replace(/^<\?[\s\S]*?\?>/, '')
      .replace(/^<!--[\s\S]*?-->/, '')
      .replace(/^<!DOCTYPE[^>]*>/i, '')
    if (rest === before) break
  }
  // Namespace prefix dropped: `<ns0:gpx>` and `<gpx>` are the same element.
  const match = /^<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(rest)
  return match ? match[1] : null
}

/**
 * @param {Uint8Array} bytes - already inflated; see inflateIfNeeded
 * @returns {'fit'|'tcx'|'gpx'|null} null means "nothing this app can parse"
 */
export function detectActivityFormat(bytes) {
  if (hasFitMagic(bytes)) return 'fit'
  // Lossy decoding is fine and deliberate: binary junk decodes to replacement
  // characters, which match no root-element pattern, which is the right answer.
  const head = new TextDecoder().decode(bytes.subarray(0, XML_SNIFF_BYTES))
  return FORMAT_BY_ROOT_ELEMENT[rootElementNameOf(head)] ?? null
}
