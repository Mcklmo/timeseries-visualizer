// Which parser does this buffer want? Pure — bytes in, format out.
//
// The bytes decide, not intervals.icu's `file_type` field. Three reasons:
// the browser cannot read Content-Disposition across this CORS boundary (see
// intervalsApi.js), so there is no filename to take an extension from;
// `file_type` is whatever the syncing service claimed and can be stale or
// simply wrong; and sniffing needs no second API call. It also keeps
// ActivityRef exactly as ARCHITECTURE.md §5 defines it, which matters because
// ErrorState's "Try again" replays a ref carrying no metadata at all.
// `file_type` is still useful as a pre-flight hint in the picker — it greys
// out rows that can't work before a request is made — but it is never the
// authority here.

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

function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
}

/**
 * Inflates the gzip stream intervals.icu's /file endpoint returns, if it is
 * still compressed by the time it reaches us.
 *
 * Checks the magic bytes rather than a header: it is unverified whether the
 * response arrives as `Content-Encoding: gzip` (the browser auto-inflates,
 * and we get plain bytes) or as an opaque gzip payload. Sniffing handles both
 * without caring which.
 *
 * **Response, never Blob.** Under jsdom, `Blob` is jsdom's while
 * `DecompressionStream` and `Response` are Node's — jsdom implements neither
 * of the latter two, so they survive on globalThis. Feeding a jsdom Blob into
 * a Node stream breaks; going through `Response` keeps everything on one side.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function gunzipIfNeeded(bytes) {
  if (!isGzip(bytes)) return bytes
  const inflated = await new Response(
    new Response(bytes).body.pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer()
  return new Uint8Array(inflated)
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
 * @param {Uint8Array} bytes - already inflated; see gunzipIfNeeded
 * @returns {'fit'|'tcx'|'gpx'|null} null means "nothing this app can parse"
 */
export function detectActivityFormat(bytes) {
  if (hasFitMagic(bytes)) return 'fit'
  // Lossy decoding is fine and deliberate: binary junk decodes to replacement
  // characters, which match no root-element pattern, which is the right answer.
  const head = new TextDecoder().decode(bytes.subarray(0, XML_SNIFF_BYTES))
  return FORMAT_BY_ROOT_ELEMENT[rootElementNameOf(head)] ?? null
}
