// The receiving half of a file link, `/#f=<base64url(file bytes)>`; see
// doc/file-link.md. Mounted once in AppShell beside useSharedActivityFromUrl.
//
// Unlike a share link, the hash is stripped before anything else: a 100K+
// character GPS track must not stay in the address bar, history or bookmarks.
// That strip is also what makes a second effect run (StrictMode) a no-op.
import { useEffect } from 'react'
import { UNREADABLE_LINK_MESSAGE } from '../data/fileFormat.js'
import { fromBase64Url } from '../lib/base64url.js'

const FILE_HASH_PREFIX = '#f='

/**
 * @param {(ref: import('../data/ActivitySource.js').FileActivityRef) => void} onLoad
 * @param {(error: Error) => void} onFail  the payload isn't base64url
 */
export function useFileFromUrl(onLoad, onFail) {
  useEffect(() => {
    const hash = globalThis.location?.hash
    if (!hash?.startsWith(FILE_HASH_PREFIX)) return
    history.replaceState(history.state, '', location.pathname + location.search)

    let bytes
    try {
      bytes = fromBase64Url(hash.slice(FILE_HASH_PREFIX.length))
    } catch {
      onFail(new Error(UNREADABLE_LINK_MESSAGE))
      return
    }
    // No extension, so the registry sniffs the bytes: inflate, detect, parse.
    onLoad({ type: 'file', file: new File([bytes], 'activity') })
  }, [onLoad, onFail])
}
