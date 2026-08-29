// Real ActivitySource adapter: share-link payload -> decodePayload ->
// normalizeActivity. The decode side of shareCodec.js, behind the same DI
// boundary as every other adapter (ARCHITECTURE.md §5) — the UI never learns
// that some activities arrive by URL.
//
// **Neither export method is implemented, on purpose.** There is no recorded
// original behind a share link — the payload is lossy and self-contained — so
// the registry's `?? false` default keeps the Export button away and its
// "isn't available to download" throw stays truthful.
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { decodePayload } from './shareCodec.js'

/** @implements {import('../ActivitySource.js').ActivitySource} */
export class SharedActivitySource {
  kind = 'shared'

  /**
   * @param {import('../ActivitySource.js').ActivityRef} ref
   * @returns {Promise<import('../../domain/types.js').Activity>}
   */
  async load(ref) {
    if (ref.type !== 'shared') {
      throw new Error('SharedActivitySource can only load a shared reference')
    }
    const { sport, name, trackpoints } = await decodePayload(ref.payload)
    const activity = normalizeActivity({ sport, trackpoints })
    // The payload carries the title the sharer saw; deriveWorkoutName's guess
    // from the decoded samples loses to it. IntervalsActivitySource sets the
    // precedent for overriding after normalize.
    return name ? { ...activity, name } : activity
  }
}
