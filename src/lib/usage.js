// Anonymous, per-page-load feature flags — the client half of the usage
// counting described in doc/USAGE_ANALYTICS.md.
//
// **What leaves the browser, exactly.** At most once per feature per page
// load, when the tab is hidden or closed, one `sendBeacon` to /api/usage
// carrying `{"v":1,"f":[...feature ids]}` and nothing else — no id, no
// timestamp, no counter, no cookie, no storage read or write. Ids come from
// shared/usageEvents.js's closed allowlist, each a yes/no fact ("a .fit file was
// opened"), never a value from an activity.
//
// **Why on hide, not when the feature is used.** The file path's promise — a
// file you open issues no request at that moment — is pinned by App.test.jsx,
// and it stays true: marking a feature is a Set insert. The single request
// happens as the visit ends, and says only which switches were touched.
//
// **Global Privacy Control and Do Not Track switch it off entirely.** Neither
// is legally required for data this coarse; honouring them anyway costs one
// line and means a visitor who has said "no" never has to trust the argument.
import { USAGE_API_PATH, USAGE_PAYLOAD_VERSION, isUsageFeature } from '../../shared/usageEvents.js'

const used = new Set()
const sent = new Set()

/**
 * Records that a feature was used during this page load. Idempotent and
 * synchronous; safe to call from render-adjacent callbacks and event handlers.
 * An id outside the allowlist is a programming error, surfaced in dev and
 * ignored in production rather than thrown from a click handler.
 *
 * @param {import('../../shared/usageEvents.js').USAGE_FEATURES[number]} feature
 */
export function markUsed(feature) {
  if (!isUsageFeature(feature)) {
    if (import.meta.env?.DEV) console.warn(`markUsed: unknown usage feature "${feature}"`)
    return
  }
  used.add(feature)
}

/** @param {Navigator|undefined} nav */
export function hasOptedOut(nav) {
  return nav?.globalPrivacyControl === true || nav?.doNotTrack === '1'
}

/**
 * Sends whatever has been marked since the last flush. Returns the ids sent,
 * or an empty array when there was nothing to send (or the visitor opted out).
 *
 * @param {{ nav?: Navigator }} [options]
 * @returns {string[]}
 */
export function flushUsage({ nav = globalThis.navigator } = {}) {
  if (hasOptedOut(nav) || typeof nav?.sendBeacon !== 'function') return []

  const pending = [...used].filter((feature) => !sent.has(feature)).sort()
  if (pending.length === 0) return []

  const body = JSON.stringify({ v: USAGE_PAYLOAD_VERSION, f: pending })
  // sendBeacon returns false when the browser refused to queue it (payload
  // limits, a closing document). Leave the features unsent so a later hide in
  // the same page load can try again.
  if (nav.sendBeacon(USAGE_API_PATH, new Blob([body], { type: 'application/json' }))) {
    for (const feature of pending) sent.add(feature)
    return pending
  }
  return []
}

/**
 * Wires the flush to the moments a page load can end. `visibilitychange` is
 * the one mobile browsers reliably fire (a phone rarely sends `pagehide` when
 * the app is swiped away); `pagehide` covers desktop navigation. Both may fire
 * for one exit, and the `sent` set makes the second a no-op.
 *
 * @param {{ win?: Window, doc?: Document, nav?: Navigator }} [options]
 * @returns {() => void} uninstall
 */
export function installUsageBeacon({
  win = globalThis.window,
  doc = globalThis.document,
  nav = globalThis.navigator,
} = {}) {
  const onHidden = () => {
    if (doc.visibilityState === 'hidden') flushUsage({ nav })
  }
  const onPageHide = () => flushUsage({ nav })
  doc.addEventListener('visibilitychange', onHidden)
  win.addEventListener('pagehide', onPageHide)
  return () => {
    doc.removeEventListener('visibilitychange', onHidden)
    win.removeEventListener('pagehide', onPageHide)
  }
}

/** Test seam: forget everything marked and sent. */
export function resetUsageForTests() {
  used.clear()
  sent.clear()
}
