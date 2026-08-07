// Real ActivitySource adapter: {type:'id'} -> intervals.icu's original
// uploaded file -> the existing parsers -> normalizeActivity. See
// ARCHITECTURE.md §5 — this is the DI boundary; no component imports this
// class directly, only App.jsx does.
//
// **There is no new parsing code here, and that is the entire point.** Because
// intervals.icu hands back the *original* file rather than a re-export, this
// path reuses parseFit/parseTcx/parseGpx byte for byte — which is why a
// Stryd pod's developer-field power survives a download exactly as it does a
// dropped file (ARCHITECTURE.md §8). That reuse is the payoff of the port
// boundary the app has had since day one.
//
// The three parsers are imported directly rather than delegated to through
// Fit/Tcx/GpxActivitySource with a synthetic File: those adapters are three
// lines each with no logic beyond read -> parse -> normalize, and a fake File
// whose `.name` is load-bearing nowhere would be worse than one more import.
//
// IntervalsApiError propagates untouched. That satisfies the port contract
// (ErrorState renders `error.message` verbatim) *and* lets the picker, which
// is the only caller that can do anything smarter, switch on `.code`.
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { parseFit } from '../fit/parseFit.js'
import { parseGpx } from '../gpx/parseGpx.js'
import { parseTcx } from '../tcx/parseTcx.js'
import { detectActivityFormat, gunzipIfNeeded } from './detectActivityFormat.js'
import { IntervalsApiError, downloadOriginalFile } from './intervalsApi.js'

/** parseFit wants an ArrayBuffer, and only the view's own bytes are the file. */
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/** @implements {import('../ActivitySource.js').ActivitySource} */
export class IntervalsActivitySource {
  kind = 'intervals'

  /**
   * `getApiKey` is a function, not the key itself: reading it at call time
   * means a Disconnect (or a key cleared in another tab) takes effect on the
   * very next load, where a key captured when this module first evaluated
   * would keep working long after the user revoked it.
   * @param {{getApiKey: () => string|null, fetchImpl?: typeof fetch}} options
   */
  constructor({ getApiKey, fetchImpl } = {}) {
    this.getApiKey = getApiKey ?? (() => null)
    this.fetchImpl = fetchImpl
  }

  /**
   * @param {import('../ActivitySource.js').ActivityRef} ref
   * @returns {Promise<import('../../domain/types.js').Activity>}
   */
  async load(ref) {
    if (ref.type !== 'id') {
      throw new Error('IntervalsActivitySource can only load an id reference')
    }

    const apiKey = this.getApiKey()
    if (!apiKey) {
      // Reported as `unauthorized` on purpose: the picker's handling for that
      // code — clear the store, drop back to the connect form — is exactly
      // the right recovery for a key that has gone missing mid-session.
      throw new IntervalsApiError('unauthorized', 'Not connected to intervals.icu — add your API key first.')
    }

    const downloaded = await downloadOriginalFile({
      apiKey,
      activityId: ref.id,
      fetchImpl: this.fetchImpl,
    })
    const bytes = await gunzipIfNeeded(downloaded)
    const parsed = await parseDownload(bytes)

    const activity = normalizeActivity(parsed)
    // The real title from intervals.icu wins over the inferred one, when the
    // picker had one to pass. It often won't — a stub row carries no name —
    // so the derived name stays the fallback rather than becoming dead code.
    return ref.name ? { ...activity, name: ref.name } : activity
  }
}

async function parseDownload(bytes) {
  const format = detectActivityFormat(bytes)
  if (format === 'fit') return parseFit(toArrayBuffer(bytes))

  const text = new TextDecoder().decode(bytes)
  if (format === 'tcx') return parseTcx(text)
  if (format === 'gpx') return parseGpx(text)

  throw new IntervalsApiError('unsupported_format')
}
