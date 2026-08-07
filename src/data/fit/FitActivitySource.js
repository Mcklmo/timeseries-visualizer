// Real ActivitySource adapter: file -> parseFit -> normalizeActivity. See
// ARCHITECTURE.md §5 — this is the DI boundary; no component ever imports
// this class directly, only App.jsx does.
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { parseFit } from './parseFit.js'

/** @implements {import('../ActivitySource.js').ActivitySource} */
export class FitActivitySource {
  kind = 'fit'

  /**
   * @param {import('../ActivitySource.js').ActivityRef} ref
   * @returns {Promise<import('../../domain/types.js').Activity>}
   */
  async load(ref) {
    if (ref.type !== 'file') {
      throw new Error('FitActivitySource can only load a file reference')
    }
    const buffer = await ref.file.arrayBuffer()
    const { id, sport, trackpoints } = await parseFit(buffer)
    return normalizeActivity({ id, sport, trackpoints })
  }
}
