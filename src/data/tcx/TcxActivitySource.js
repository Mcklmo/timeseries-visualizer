// Real ActivitySource adapter: file -> parseTcx -> normalizeActivity. See
// ARCHITECTURE.md §5 — this is the DI boundary; no component ever imports
// this class directly, only ActivitySourceProvider does (from App.jsx).
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { parseTcx } from './parseTcx.js'

/** @implements {import('../ActivitySource.js').ActivitySource} */
export class TcxActivitySource {
  kind = 'tcx'

  /**
   * @param {import('../ActivitySource.js').ActivityRef} ref
   * @returns {Promise<import('../../domain/types.js').Activity>}
   */
  async load(ref) {
    if (ref.type !== 'file') {
      throw new Error('TcxActivitySource can only load a file reference')
    }
    const xmlText = await ref.file.text()
    const { sport, trackpoints } = parseTcx(xmlText)
    return normalizeActivity({ sport, trackpoints })
  }
}
