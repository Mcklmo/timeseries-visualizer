// The browser half of Strava's OAuth flow: build the authorize URL, mint and
// consume the CSRF state, and read what comes back on the callback. No fetch
// here — the code exchange is stravaApi.js's, through the Worker.
//
// **`redirect_uri` is `${origin}/`.** Strava pins only the *domain* of an app's
// Authorization Callback Domain, so any path on it is legal, and `/` is already
// served. That adds nothing to worker/index.js and nothing to the prerendered
// SEO pages. There is no router in this app — the view is a `useState` in
// AppShell — and the deliberate non-SPA `not_found_handling` should not be
// fought for a callback URL.
//
// **A Strava app has exactly one Authorization Callback Domain**, so one app
// cannot serve both activitymaxxer.com and localhost. Two apps are registered;
// which one this build talks to is VITE_STRAVA_CLIENT_ID (see .env).
//
// **Scope is `activity:read_all`, and it is disclosed on the button.**
// `activity:read` silently excludes private activities, and "my run isn't in
// the list" is a confusing failure that looks like a bug in this app. The
// granted scope is verified on the way back, because Strava lets the athlete
// untick it on the consent screen — in which case the honest thing is to say
// so, not to show a mysteriously short list.
//
// The raw `Storage` is used here rather than lib/safeStorage's wrapper: this
// module needs `getItem`-then-`removeItem` as one guarded unit (see
// `consumeStoredState`), which is not a shape the wrapper offers. The guarded
// property read is still shared.
import { sessionStorageOrNull } from '../../lib/safeStorage.js'

/** The scope this app asks for. Read-only; nothing here can write to Strava. */
export const REQUIRED_SCOPE = 'activity:read_all'

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'

/**
 * One-shot, tab-scoped, must evaporate — so **sessionStorage**, not
 * localStorage. An OAuth return that lands in a different tab then correctly
 * fails to validate rather than being silently accepted, and nothing is left
 * behind on a shared machine.
 */
export const STRAVA_STATE_STORAGE_KEY = 'timeseries-visualizer.strava.oauthState'

/**
 * @param {{clientId: string, origin: string, state: string}} input
 * @returns {string}
 */
export function buildAuthorizeUrl({ clientId, origin, state }) {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${origin}/`)
  url.searchParams.set('response_type', 'code')
  // Without this, Strava silently reuses an existing grant and the athlete
  // never sees the scope they are agreeing to. 'auto' is the alternative and
  // is worse for a permission this app wants stated out loud.
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('scope', REQUIRED_SCOPE)
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Mints a state, stores it, and returns the URL to send the browser to. The
 * caller does `location.assign` — navigation is not this module's job, which
 * is what makes it testable without a jsdom navigation stub.
 *
 * `crypto.randomUUID()` is available in every browser this app supports and in
 * jsdom; there is no polyfill and no dependency.
 *
 * @param {{clientId: string, origin?: string, storage?: Storage|null}} input
 * @returns {string} the authorize URL
 */
export function beginAuthorization({
  clientId,
  origin = globalThis.location?.origin,
  storage = sessionStorageOrNull(),
}) {
  const state = globalThis.crypto.randomUUID()
  try {
    storage?.setItem(STRAVA_STATE_STORAGE_KEY, state)
  } catch {
    // Storage refused. The flow still runs; `consumeStoredState` will find
    // nothing and refuse the callback, which is the safe direction to fail in.
  }
  return buildAuthorizeUrl({ clientId, origin, state })
}

/**
 * **Read and delete, single use.** A state that has been checked once is spent:
 * leaving it in place would let a replayed callback URL be accepted a second
 * time. Deleting before comparing also means a failed comparison cannot be
 * retried against the same stored value.
 *
 * @param {Storage|null} [storage]
 * @returns {string|null}
 */
export function consumeStoredState(storage = sessionStorageOrNull()) {
  try {
    const state = storage?.getItem(STRAVA_STATE_STORAGE_KEY) || null
    storage?.removeItem(STRAVA_STATE_STORAGE_KEY)
    return state
  } catch {
    return null
  }
}

/**
 * What Strava put in the query string on the way back, or null when this is an
 * ordinary page load — which is the overwhelmingly common case, so it has to
 * be cheap and it has to be certain.
 *
 * Three outcomes, all of them normal:
 *   - `{code, state, scope}` — the athlete approved.
 *   - `{error: 'access_denied'}` — they pressed Cancel. **A user choice, not
 *     an error state**, and it gets its own copy.
 *   - null — not a callback at all.
 *
 * @param {string} [search] `location.search`
 * @returns {{code?: string, state?: string, scope?: string, error?: string}|null}
 */
export function readCallbackParams(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search)
  const code = params.get('code')
  const error = params.get('error')
  if (!code && !error) return null

  return {
    code: code ?? undefined,
    state: params.get('state') ?? undefined,
    scope: params.get('scope') ?? undefined,
    error: error ?? undefined,
  }
}

/**
 * Strava returns the *granted* scopes as a comma-separated list, which is not
 * necessarily what was asked for: the consent screen lets the athlete untick
 * "View data about your private activities".
 *
 * @param {string} [grantedScope]
 */
export function hasRequiredScope(grantedScope) {
  return String(grantedScope ?? '')
    .split(',')
    .includes(REQUIRED_SCOPE)
}
