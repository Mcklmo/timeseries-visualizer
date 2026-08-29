// The receiving half of the share-link feature: what happens when someone
// opens `/#a=<payload>`. Mounted **once**, in AppShell, for the same reason
// the Strava OAuth hook is — an incoming share is a property of the page
// load, not of any view (useStravaOAuthCallback.js is the template, and its
// module header argues the pattern in full).
//
// The differences from that template are deliberate, not drift:
//
//   - **It takes a callback where the OAuth hook refuses one.** That hook
//     returns a status because it has an outcome to report and a re-running
//     effect to defend; this one has nothing to report — its entire job is to
//     fire one `load`, and everything after that (loading, error, ready) is
//     ActivityContext's story, rendered by the branches AppShell already has.
//     The single-shot ref is what makes callback-identity churn harmless.
//   - **The hash is NOT stripped.** The OAuth strip exists because the code
//     is single-use; a share payload is idempotent to re-consume, and keeping
//     it is what makes the link bookmarkable, reload-safe and re-shareable
//     straight from the address bar. The URL only stops describing the screen
//     when a different activity loads — which is clearSharedHash()'s job, in
//     AppShell's load path.
//
// StrictMode double-invoke matters less here than there (a double load is
// wasteful, not destructive), but the guard costs one ref and keeps the
// house's one pattern for run-once-per-page-life effects.
import { useEffect, useRef } from 'react'
import { readSharedPayloadFromHash } from '../data/shared/shareCodec.js'

/**
 * @param {(ref: import('../data/ActivitySource.js').SharedActivityRef) => void} onLoad
 *   AppShell's loadRef — dispatches into ActivityContext.
 */
export function useSharedActivityFromUrl(onLoad) {
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    // Overwhelmingly the common case: an ordinary page load. One string
    // comparison, nothing read or written — a visitor who never follows a
    // share link must not pay for this hook being mounted.
    const payload = readSharedPayloadFromHash(globalThis.location?.hash)
    if (payload === null) return

    handled.current = true
    onLoad({ type: 'shared', payload })
  }, [onLoad])
}
