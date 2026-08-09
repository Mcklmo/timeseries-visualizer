// Low-level client for Strava — talking to **this app's own Worker**, at
// `/api/strava/*`, not to strava.com. That is the one place this app's
// architecture differs per provider, and it is deliberate: see
// worker/routes/strava.js for why (a required `client_secret`, and CORS that
// has come and gone more than once).
//
// **The bodies are Strava's, verbatim.** The Worker proxies rather than
// translates, so everything below is written against Strava's documented wire
// shape. If Strava's CORS ever becomes reliable, going direct is changing
// STRAVA_PROXY_BASE and deleting a Worker route — not rewriting this file.
// The two exceptions are the token endpoints, which cannot be a browser call
// at all and therefore have a shape of the Worker's own.
//
// CONVENTION: this throws, exactly as intervalsApi.js does and for the same
// reason — the adapter lets a StravaApiError propagate untouched (ErrorState
// renders `error.message` verbatim), while the picker catches and switches on
// `.code`, because "reconnect" and "the network failed" need different
// recoveries. One convention, both needs met.
//
// **Two different 429s, and telling them apart is the whole reason our Worker
// uses a different code for its own.** Strava's rate limit can name a real
// wait — its 15-minute window resets at :00/:15/:30/:45, and the headers are
// readable because this is same-origin (the intervals.icu path can read
// nothing, which is why its copy names no time). Our Worker's burst cap is a
// different thing entirely. Neither is ever retried automatically.
import { isExpired, stravaTokenStore } from './stravaTokenStore.js'

/** Same-origin, so no CORS, no preflight, and the rate-limit headers are
 *  readable — see the header. */
export const STRAVA_PROXY_BASE = '/api/strava'

/** Where the athlete manages the grant this app holds. Linked from Disconnect. */
export const STRAVA_APP_SETTINGS_URL = 'https://www.strava.com/settings/apps'

/**
 * @typedef {'not_connected'|'unauthorized'|'forbidden'|'not_found'|'athlete_cap'
 *   |'invalid_grant'|'no_streams'|'rate_limited'|'app_rate_limited'
 *   |'network'|'unexpected'} StravaErrorCode
 */

/** @type {Record<StravaErrorCode, string>} */
const MESSAGE_BY_CODE = {
  not_connected: 'Not connected to Strava — connect your account first.',
  unauthorized: 'Strava no longer accepts this connection. Please connect again.',
  forbidden: "Your Strava account doesn't allow access to that activity.",
  not_found: 'That activity no longer exists on Strava.',
  athlete_cap:
    'This app can connect a limited number of Strava accounts, and it is currently full. ' +
    'This is a limit on the app, not on your account.',
  invalid_grant: 'Strava rejected that authorization. Please connect again.',
  no_streams: "Strava has no recorded data for that activity — there's nothing to chart.",
  rate_limited: "Strava's rate limit was reached. It resets on the quarter hour — try again then.",
  app_rate_limited: 'Too many requests from this connection. Please wait a moment and try again.',
  network: "Couldn't reach Strava.",
  unexpected: 'Strava is having trouble right now.',
}

/** Everything else — including codes Strava doesn't document — is `unexpected`. */
const CODE_BY_STATUS = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  429: 'rate_limited',
}

export class StravaApiError extends Error {
  /**
   * @param {StravaErrorCode} code
   * @param {string} [message] - defaults to the code's user-facing copy
   */
  constructor(code, message = MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.unexpected) {
    super(message)
    this.name = 'StravaApiError'
    this.code = code
  }
}

/**
 * A failed response -> the right code. Our Worker's own failures carry the
 * `{ok:false, error}` envelope; Strava's arrive verbatim with no envelope at
 * all. That difference is the discriminator, and it is why the Worker never
 * wraps a proxied body.
 */
async function errorFor(response) {
  let body = null
  try {
    body = await response.json()
  } catch {
    // A proxy or an error page answering with HTML where JSON was promised.
  }

  if (body?.ok === false && typeof body.error === 'string') {
    // The Worker named the failure. `app_rate_limited` and `athlete_cap` can
    // only ever arrive this way.
    const known = body.error in MESSAGE_BY_CODE ? body.error : null
    if (known) return new StravaApiError(known, body.message || undefined)
  }
  return new StravaApiError(CODE_BY_STATUS[response.status] ?? 'unexpected')
}

/**
 * @param {string} path relative to STRAVA_PROXY_BASE, already encoded
 * @param {{accessToken?: string, method?: string, body?: object,
 *          search?: Record<string, string>, fetchImpl?: typeof fetch}} options
 * @returns {Promise<unknown>} the parsed JSON body
 */
async function request(path, { accessToken, method = 'GET', body, search, fetchImpl = fetch } = {}) {
  // Relative, resolved against the page — same origin by construction, which
  // is what makes the whole no-CORS story true. A URL with an origin in it
  // would be the first step to reintroducing the problem the Worker solves.
  const query = new URLSearchParams(search ?? {}).toString()
  const url = `${STRAVA_PROXY_BASE}${path}${query ? `?${query}` : ''}`

  const headers = { accept: 'application/json' }
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  if (body) headers['content-type'] = 'application/json'

  let response
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // Nothing here is cookie-authenticated; the bearer token is the whole
      // credential. 'omit' keeps it that way.
      credentials: 'omit',
    })
  } catch {
    throw new StravaApiError('network')
  }

  if (!response.ok) throw await errorFor(response)

  try {
    return await response.json()
  } catch {
    throw new StravaApiError('unexpected')
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/**
 * Trades the one-time `code` from the OAuth callback for tokens. The Worker
 * adds `client_secret`; the browser never sees it.
 *
 * @param {{code: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<import('./stravaTokenStore.js').StravaTokens & {athlete?: object}>}
 */
export async function exchangeCode({ code, fetchImpl }) {
  return /** @type {any} */ (await request('/token', { method: 'POST', body: { code }, fetchImpl }))
}

/**
 * @param {{accessToken: string, fetchImpl?: typeof fetch}} options
 */
export async function deauthorize({ accessToken, fetchImpl }) {
  return request('/deauthorize', { method: 'POST', accessToken, fetchImpl })
}

// ---------------------------------------------------------------------------
// Token freshness (T5)
// ---------------------------------------------------------------------------

/**
 * In-flight refreshes, one slot per store.
 *
 * **Why this exists.** Refresh tokens rotate: the response carries a new one
 * and kills the one that was sent. So two concurrent refreshes — a picker
 * mounting while an activity loads is enough — race, and whichever lands
 * second has already been invalidated by the first. The athlete is silently
 * signed out, at a moment that looks unrelated to anything they did.
 *
 * De-duplicating means the second caller awaits the first call's promise
 * instead of starting its own. Keyed by store rather than module-global so a
 * test's injected store can never share state with another test's.
 *
 * @type {WeakMap<object, Promise<import('./stravaTokenStore.js').StravaTokens>>}
 */
const inFlightRefresh = new WeakMap()

/**
 * @param {{store: object, fetchImpl?: typeof fetch}} options
 * @returns {Promise<import('./stravaTokenStore.js').StravaTokens>}
 */
function refreshTokens({ store, fetchImpl }) {
  const existing = inFlightRefresh.get(store)
  if (existing) return existing

  const pending = (async () => {
    const current = store.read()
    if (!current) throw new StravaApiError('not_connected')

    const tokens = /** @type {any} */ (
      await request('/refresh', {
        method: 'POST',
        body: { refreshToken: current.refreshToken },
        fetchImpl,
      })
    )
    // The rotated refresh token is in this response and the old one is now
    // dead — persisting it is not optional. `athleteId` is carried across
    // because a refresh response has no `athlete`.
    store.save({ ...tokens, athleteId: current.athleteId ?? null })
    return store.read()
  })().finally(() => {
    inFlightRefresh.delete(store)
  })

  inFlightRefresh.set(store, pending)
  return pending
}

/**
 * The current access token, refreshed first if it is at or near expiry.
 *
 * This is what `getStravaAccessToken` in sourceRegistry.js resolves — and the
 * reason that thunk is **async**, unlike intervals.icu's `getApiKey`, which
 * returns a string that never expires.
 *
 * @param {{store?: object, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<string>}
 */
export async function readFreshAccessToken({ store = stravaTokenStore, fetchImpl } = {}) {
  const current = store.read()
  if (!current) throw new StravaApiError('not_connected')
  if (!isExpired(current)) return current.accessToken

  const refreshed = await refreshTokens({ store, fetchImpl })
  if (!refreshed) throw new StravaApiError('not_connected')
  return refreshed.accessToken
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Enough to fill a phone screen several times; Strava caps this at 100. */
export const ACTIVITY_PAGE_SIZE = 50

/**
 * The athlete's activities, newest first.
 *
 * `before`/`after` are **epoch seconds**, and `before` is *exclusive* — see
 * stravaBoundsFor.js, which is the only caller that computes them and exists
 * to get that conversion right in one place.
 *
 * Paging is by widening the date range rather than by Strava's `page` param,
 * so this picker and the intervals.icu one behave identically and share
 * `widenedStart`.
 *
 * @param {{accessToken: string, after?: number, before?: number, perPage?: number,
 *          fetchImpl?: typeof fetch}} options
 * @returns {Promise<object[]>} SummaryActivity[], verbatim
 */
export async function listActivities({
  accessToken,
  after,
  before,
  perPage = ACTIVITY_PAGE_SIZE,
  fetchImpl,
}) {
  const search = { per_page: String(perPage) }
  // Set only when given: a stray `undefined` would go over the wire as the
  // string "undefined", which Strava reads as 0.
  if (Number.isFinite(after)) search.after = String(after)
  if (Number.isFinite(before)) search.before = String(before)

  const body = await request('/activities', { accessToken, search, fetchImpl })
  return Array.isArray(body) ? body : []
}

/**
 * The stream keys this app asks for, and the complete reasoning about the ones
 * it does not:
 *
 *   - **`moving` is never requested.** normalizeActivity derives pauses with
 *     detectPauses, so every format — dropped file, intervals.icu download,
 *     Strava — behaves identically. Not requesting it is a stronger form of
 *     discarding it: there is no field for a later change to start reading.
 *   - **`temp` and `grade_smooth` are not requested.** RawTrackpoint has no
 *     home for either. `temp` is the obvious seam if a temperature metric is
 *     ever added to metricRegistry.
 *   - **`velocity_smooth` IS requested, knowingly.** deriveSpeed.js
 *     short-circuits the moment any trackpoint carries `speedMps`, so this
 *     stream — not the app's own derivation — drives every pace chart on the
 *     Strava path, and the same activity will not numerically match its own
 *     FIT file. Requested anyway because adapters do field mapping, not
 *     interpretation, and this is Strava's own displayed number. The
 *     divergence is documented in streamsToTrackpoints.js and the fixture
 *     cross-check is tolerant of it.
 */
export const STREAM_KEYS = [
  'time',
  'distance',
  'altitude',
  'heartrate',
  'cadence',
  'watts',
  'velocity_smooth',
  'latlng',
]

/**
 * One activity's streams, keyed by type.
 *
 * The Worker pins `key_by_type=true` and never sends `resolution` — any
 * resolution at all makes Strava resample, and the raw stream is the point.
 *
 * @param {{accessToken: string, activityId: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<object>} StreamSet, verbatim
 */
export async function fetchStreams({ accessToken, activityId, fetchImpl }) {
  const body = await request(`/activities/${encodeURIComponent(activityId)}/streams`, {
    accessToken,
    search: { keys: STREAM_KEYS.join(',') },
    fetchImpl,
  })
  // A 200 whose body is not an object is not a stream set. Reported as the
  // same "nothing recorded" this app shows for an activity with no telemetry,
  // rather than as bytes we failed to understand.
  if (!body || typeof body !== 'object') throw new StravaApiError('no_streams')
  return body
}
