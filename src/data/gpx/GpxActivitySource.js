// Real ActivitySource adapter: file -> parseGpx -> normalizeActivity. See
// ARCHITECTURE.md §5 — this is the DI boundary; no component ever imports
// this class directly, only ActivitySourceProvider does (from App.jsx).
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { parseGpx } from './parseGpx.js'

/** @implements {import('../ActivitySource.js').ActivitySource} */
export class GpxActivitySource {
  kind = 'gpx'

  /**
   * @param {import('../ActivitySource.js').ActivityRef} ref
   * @returns {Promise<import('../../domain/types.js').Activity>}
   */
  async load(ref) {
    if (ref.type !== 'file') {
      throw new Error('GpxActivitySource can only load a file reference')
    }
    const xmlText = await ref.file.text()
    const { sport, trackpoints } = parseGpx(xmlText)
    return normalizeActivity({ sport, trackpoints })
  }
}
