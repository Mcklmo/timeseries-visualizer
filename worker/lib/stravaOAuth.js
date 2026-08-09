// The only place STRAVA_CLIENT_SECRET is used. Nothing here ever returns
// Strava's own error body to the caller — `status` is kept for the route to log
// and to map, and the route answers with copy of its own, so a misconfigured or
// revoked client secret cannot leak its message (or itself) into a browser
// response. Same rule githubClient.js's header states, for the same reason.
//
// **Why the Worker holds this at all**, when intervals.icu talks to the browser
// directly: Strava requires `client_secret` on the initial code exchange *and*
// on every refresh. A secret that ships in a static bundle is not a secret, so
// the token endpoints cannot be a browser-side call at any price. That, plus
// Strava's repeatedly-unreliable CORS on the data endpoints, is why this app
// gives up its "no server-side code" property for this one provider.
//
// **Refresh tokens rotate.** Every refresh response carries a *new*
// `refresh_token`, and the one that was sent is dead the moment it succeeds.
// Callers must store what comes back, not what they sent. Losing that value
// means the athlete has to reconnect from scratch.
const STRAVA_OAUTH_ORIGIN = 'https://www.strava.com'

const TOKEN_URL = `${STRAVA_OAUTH_ORIGIN}/oauth/token`
const DEAUTHORIZE_URL = `${STRAVA_OAUTH_ORIGIN}/oauth/deauthorize`

/**
 * @typedef {object} StravaTokens
 * @property {string} accessToken
 * @property {string} refreshToken - the rotated one; replaces whatever was sent
 * @property {number} expiresAt - epoch **milliseconds**; see readTokens
 * @property {object} [athlete] - only on the initial exchange, never on refresh
 */

/**
 * @typedef {{ok: true, tokens: StravaTokens}
 *   | {ok: false, status: number|null, detail: string, athleteCap?: boolean}} TokenResult
 */

/**
 * Does this rejection look like the Standard Tier athlete cap rather than a
 * bad code?
 *
 * **Why it matters:** Standard Tier allows an app 10 connected athletes, and
 * athlete 11's exchange simply fails. Reported as a generic auth failure it
 * reads as "your Strava login is broken", which is both wrong and unfixable by
 * the person seeing it. Named honestly it reads as "this app is full", which
 * is true and is not their problem to solve.
 *
 * **The signature is inferred, not documented.** Strava's token endpoint
 * answers app-level refusals with an `errors` entry whose `resource` is
 * `Application`, where a spent or wrong code names `AuthorizationCode` or
 * `Athlete`. That is the narrowest reliable-looking discriminator available;
 * Strava documents none. It is used only to *pick better copy* — a false
 * negative falls back to `invalid_grant`, which is the previous behaviour, and
 * a false positive shows the cap message for some other app-level refusal,
 * which is still closer to true than "reconnect" would be. Nothing about
 * control flow, storage or security depends on it.
 *
 * Strava's body is read here and **never returned** — it can name the client.
 */
function looksLikeAthleteCap(body) {
  const errors = body?.errors
  return Array.isArray(errors) && errors.some((e) => e?.resource === 'Application')
}

/**
 * Strava's token payload -> ours.
 *
 * **`expiresAt` is converted to milliseconds here, deliberately.** Strava
 * reports `expires_at` in epoch *seconds*. Its only consumer is a browser
 * comparing it against `Date.now()`, which is in milliseconds — and a seconds
 * value compared against `Date.now()` is always in the past, which reads as
 * "expired" on every single call and turns the refresh path into an infinite
 * loop that still looks like it is working. Converting once, at the boundary
 * that owns the wire shape, is the only place this can be got right in one
 * line. The field is renamed (`expires_at` -> `expiresAt`) partly so the unit
 * change is not silent.
 */
function readTokens(payload) {
  const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = payload ?? {}
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null
  if (!Number.isFinite(expiresAt)) return null

  const tokens = { accessToken, refreshToken, expiresAt: expiresAt * 1000 }
  // Present on the authorization_code grant, absent on a refresh. Passed
  // through as Strava sent it — the client uses `athlete.id` to notice that a
  // *different* athlete just connected in this browser.
  if (payload.athlete) tokens.athlete = payload.athlete
  return tokens
}

/**
 * @param {URLSearchParams} body
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<TokenResult>}
 */
async function postToken(body, fetchImpl) {
  let response
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    })
  } catch (error) {
    return { ok: false, status: null, detail: `request failed: ${error.message}` }
  }

  if (!response.ok) {
    // Read for classification only. Nothing from it is returned or logged
    // verbatim; see looksLikeAthleteCap.
    const errorBody = await response.json().catch(() => null)
    return {
      ok: false,
      status: response.status,
      detail: `strava responded ${response.status}`,
      athleteCap: looksLikeAthleteCap(errorBody),
    }
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return { ok: false, status: response.status, detail: 'strava token response was not JSON' }
  }

  const tokens = readTokens(payload)
  if (!tokens) {
    return { ok: false, status: response.status, detail: 'strava token response was missing fields' }
  }
  return { ok: true, tokens }
}

/**
 * The `authorization_code` grant. **No `redirect_uri`** — Strava does not want
 * one on the exchange (unlike most OAuth 2 servers), and sending one is not
 * merely redundant, it is a shape the endpoint does not document.
 *
 * The `code` is **single use**. A second exchange of the same code fails with a
 * 400 that reads like a credentials problem, which is why the browser side
 * guards against React's StrictMode double-invoke before ever getting here.
 *
 * @param {{clientId: string, clientSecret: string, code: string, fetchImpl?: typeof fetch}} input
 * @returns {Promise<TokenResult>}
 */
export async function exchangeAuthorizationCode({ clientId, clientSecret, code, fetchImpl = fetch }) {
  return postToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
    fetchImpl,
  )
}

/**
 * Trades a refresh token for a fresh access token **and a new refresh token**.
 * See the header: the one passed in is dead afterwards.
 *
 * @param {{clientId: string, clientSecret: string, refreshToken: string, fetchImpl?: typeof fetch}} input
 * @returns {Promise<TokenResult>}
 */
export async function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  return postToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    fetchImpl,
  )
}

/**
 * Revokes the athlete's grant at Strava. This is the API Policy §7.4
 * obligation, and it is the one part of Disconnect that clearing local storage
 * cannot satisfy: everything else this app holds evaporates on its own, but the
 * *grant* lives on Strava's side until something asks for it to be dropped.
 *
 * Takes the athlete's access token, not the client secret — it is an
 * authenticated call on their behalf.
 *
 * @param {{accessToken: string, fetchImpl?: typeof fetch}} input
 * @returns {Promise<{ok: true} | {ok: false, status: number|null, detail: string}>}
 */
export async function deauthorize({ accessToken, fetchImpl = fetch }) {
  let response
  try {
    response = await fetchImpl(DEAUTHORIZE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    })
  } catch (error) {
    return { ok: false, status: null, detail: `request failed: ${error.message}` }
  }

  if (!response.ok) {
    return { ok: false, status: response.status, detail: `strava responded ${response.status}` }
  }
  return { ok: true }
}
