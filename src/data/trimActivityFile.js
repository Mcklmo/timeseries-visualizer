// Which trimmer do these bytes want? The write-path twin of fileFormat.js's
// read-path question, and it lives beside it for the reason that file's header
// already gives: nothing in it is one provider's. A dropped `.tcx`, a `.fit.gz`
// out of a bulk export and an intervals.icu download all arrive here as bytes
// and leave as bytes, and none of the three trimmers below has to learn where
// its document came from.
//
// **The bytes decide, not the filename.** Same rule as the read path, and here
// it is not even a preference: the intervals.icu route has no filename at all
// (Content-Disposition is unreadable across that CORS boundary — see
// intervalsApi.js), so the format is genuinely unknowable until the download
// lands.
//
// This is also the single place the text codec lives. Each trimmer is
// string-in/string-out, mirroring its parser, so none of them carries an
// opinion about encodings and there is exactly one place to fix when a
// non-UTF-8 TCX finally turns up (see ARCHITECTURE.md §0).
import { detectActivityFormat } from './fileFormat.js'
import { trimFit } from './fit/trimFit.js'
import { trimGpx } from './gpx/trimGpx.js'
import { trimTcx } from './tcx/trimTcx.js'

/**
 * A Uint8Array's OWN bytes as an ArrayBuffer.
 *
 * `gunzipIfNeeded`'s output can be a view into a larger buffer, and the FIT
 * decoder reads whole buffers — handing it the backing store would feed it
 * whatever else lives in there. Canonical here because this was its third
 * copy-paste site; IntervalsActivitySource.js keeps its own for the read path.
 *
 * @param {Uint8Array} bytes
 * @returns {ArrayBuffer}
 */
export function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/**
 * Trim an activity file of any supported format to a wall-clock window.
 *
 * @param {Uint8Array} bytes - the original file, **ALREADY INFLATED**. The
 *   gunzip belongs to whoever produced the bytes (`readOriginalBytes` on the
 *   source), so a caller never has to know whether its bytes came off disk or
 *   off the wire still compressed.
 * @param {{from: Date, to: Date}} window - inclusive at both ends, in the
 *   file's own wall clock
 * @returns {Promise<{bytes: Uint8Array, extension: 'fit'|'tcx'|'gpx'}>} the
 *   trimmed file, and the extension the caller should name the download with —
 *   which for an id ref is the only way to know what it just downloaded.
 */
export async function trimActivityFile(bytes, { from, to }) {
  const format = detectActivityFormat(bytes)

  if (format === 'fit') {
    return { bytes: await trimFit(toArrayBuffer(bytes), { from, to }), extension: 'fit' }
  }

  if (format === 'tcx' || format === 'gpx') {
    // ⚠️ `TextDecoder()` assumes UTF-8, and the encoding written back below
    // says so. An ISO-8859-1 TCX would have its non-ASCII text mangled. That is
    // pre-existing on the read path (IntervalsActivitySource.js:86,
    // TcxActivitySource.js), but this is the first path that writes the bytes
    // back out, so it is recorded rather than left to be discovered from a
    // mangled athlete name.
    const text = new TextDecoder().decode(bytes)
    const trimmed = format === 'tcx' ? trimTcx(text, { from, to }) : trimGpx(text, { from, to })
    return { bytes: new TextEncoder().encode(trimmed), extension: format }
  }

  // Reached in practice only from an id ref, where the format cannot be known
  // before the download lands — a dropped file was already gated on its name.
  // Worded for the athlete, because ExportWindowButton renders it beside the
  // button verbatim.
  throw new Error("Couldn't export that window — this file isn't a FIT, TCX or GPX recording")
}
