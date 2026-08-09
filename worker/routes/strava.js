// /api/strava/* — the only server-side code this app has beyond the feedback
// form, and the only place its "nothing goes through this app's server"
// property is given up. That is a deliberate, provider-scoped trade:
// intervals.icu keeps talking to its API straight from the browser, because it
// sends CORS headers and needs no secret; Strava requires `client_secret` on
// every token call and has lost and regained CORS on its data endpoints more
// than once. A secret cannot live in a static bundle at any price, and a CORS
// regression would be a total outage — so the proxy exists from day one rather
// than being the fix applied after the outage.
//
// Order inside each handler is the same as feedback.js's and for the same
// reason: cheap local rejections first, then the rate limit, then the network
// call. Nothing reaches Strava that this Worker could have refused itself.
//
// **This route stores nothing.** See stravaProxy.js — statelessness is what
// makes API Policy §6.3 and §7.4 trivially satisfied server-side.
import { errorResponse, jsonResponse } from '../lib/httpResponses.js'
import { isWithinRateLimit } from '../lib/rateLimit.js'
import { deauthorize, exchangeAuthorizationCode, refreshAccessToken } from '../lib/stravaOAuth.js'
import { proxyStravaRead } from '../lib/stravaProxy.js'

export const STRAVA_ROUTE_PREFIX = '/api/strava/'

// Strava caps `per_page` at 100 and answers larger values unhelpfully. Clamped
// here rather than trusted from the query string, which is client-supplied.
const MAX_PER_PAGE = 100

// A token exchange body is two short strings. Anything larger is not one.
const MAX_BODY_BYTES = 4 * 1024

// Strava's ids are positive integers. Validated before interpolation into a
// path — this is the only place a client-supplied value reaches the upstream
// URL, so it is the only place a path-traversal or query-injection attempt
// could land.
const ACTIVITY_ID_PATTERN = /^\d+$/

/** @returns {Promise<{ok: true, value: object} | {ok: false}>} */
async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { ok: false }
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false }
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? { ok: true, value } : { ok: false }
  } catch {
    return { ok: false }
  }
}

/**
 * Both halves of the OAuth client credential, or null. Absent means a deploy
 * that never ran `wrangler secret put` — a server fault, reported as a generic
 * 500 with nothing about which half is missing.
 */
function oauthConfig(env) {
  const clientId = env?.STRAVA_CLIENT_ID
  const clientSecret = env?.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/** A deploy that never ran `wrangler secret put` — a server fault, not the
 *  athlete's, and not something to describe in detail to a browser. */
function misconfigured() {
  console.error('strava: missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET')
  return errorResponse(500, 'internal_error', 'Strava is temporarily unavailable.')
}

/** The athlete's own bearer token, forwarded upstream and never read here. */
function hasBearer(request) {
  return /^Bearer\s+\S/i.test(request.headers.get('authorization') ?? '')
}

/**
 * Our limiter rejecting is reported as `app_rate_limited`, which is
 * deliberately NOT the code Strava's own 429 produces. The client shows
 * different copy for each: Strava's 429 can name a real wait (its window
 * resets at :00/:15/:30/:45 and the headers come back readable, same-origin),
 * ours cannot and means something else entirely.
 */
async function rateLimited(request, env) {
  const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (await isWithinRateLimit(env?.STRAVA_RATE_LIMITER, clientIp)) return null
  return errorResponse(429, 'app_rate_limited', 'Too many requests from this connection. Please wait a moment.')
}

/** Shared by /token and /refresh — the two differ only in the grant. */
function tokenFailure(result) {
  // Strava's own body is never returned: it can name the client, and on a
  // misconfiguration it describes the credential. Detail goes to the log.
  console.error(`strava oauth: ${result.detail}`)
  if (result.status === 400 || result.status === 401) {
    return errorResponse(400, 'invalid_grant', 'Strava rejected that authorization. Please connect again.')
  }
  return errorResponse(502, 'upstream_error', "Couldn't complete the Strava connection. Please try again.")
}

async function handleToken(request, env) {
  // Body before config, matching feedback.js: a request that was malformed
  // anyway must not be reported as a server fault, and the client can act on a
  // 400 where a 500 only tells it to give up.
  const body = await readJsonBody(request)
  if (!body.ok || typeof body.value.code !== 'string' || !body.value.code) {
    return errorResponse(400, 'invalid_request', 'That request could not be read.')
  }

  const config = oauthConfig(env)
  if (!config) return misconfigured()

  const result = await exchangeAuthorizationCode({ ...config, code: body.value.code })
  if (!result.ok) return tokenFailure(result)
  return jsonResponse(200, result.tokens)
}

async function handleRefresh(request, env) {
  const body = await readJsonBody(request)
  if (!body.ok || typeof body.value.refreshToken !== 'string' || !body.value.refreshToken) {
    return errorResponse(400, 'invalid_request', 'That request could not be read.')
  }

  const config = oauthConfig(env)
  if (!config) return misconfigured()

  const result = await refreshAccessToken({ ...config, refreshToken: body.value.refreshToken })
  if (!result.ok) return tokenFailure(result)
  // The refresh token in this response is a NEW one. The client must store it;
  // the one it sent is dead. See stravaOAuth.js.
  return jsonResponse(200, result.tokens)
}

async function handleDeauthorize(request) {
  if (!hasBearer(request)) {
    return errorResponse(401, 'unauthorized', 'Not connected to Strava.')
  }
  const accessToken = request.headers.get('authorization').replace(/^Bearer\s+/i, '')

  const result = await deauthorize({ accessToken })
  if (!result.ok) {
    console.error(`strava deauthorize: ${result.detail}`)
    return errorResponse(502, 'upstream_error', "Couldn't disconnect from Strava. Please try again.")
  }
  return jsonResponse(200, { ok: true })
}

/**
 * `after`/`before` are **epoch seconds** at Strava, not day strings — the unit
 * conversion happens client-side in `data/strava/`, and this route only checks
 * that what arrived is numeric before passing it on.
 */
function activityListSearch(url) {
  const search = new URLSearchParams()
  for (const name of ['before', 'after', 'page']) {
    const value = url.searchParams.get(name)
    if (value !== null && /^\d+$/.test(value)) search.set(name, value)
  }
  const perPage = Number(url.searchParams.get('per_page'))
  search.set('per_page', String(Number.isFinite(perPage) && perPage > 0 ? Math.min(perPage, MAX_PER_PAGE) : 30))
  return search
}

/**
 * @param {Request} request
 * @param {object} env wrangler vars + secrets + bindings
 */
export async function handleStravaRequest(request, env) {
  try {
    const url = new URL(request.url)
    const path = url.pathname.slice(STRAVA_ROUTE_PREFIX.length)

    const limited = await rateLimited(request, env)
    if (limited) return limited

    if (path === 'token') {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      return await handleToken(request, env)
    }

    if (path === 'refresh') {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      return await handleRefresh(request, env)
    }

    if (path === 'deauthorize') {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      return await handleDeauthorize(request)
    }

    if (path === 'activities') {
      if (request.method !== 'GET') return methodNotAllowed('GET')
      if (!hasBearer(request)) return errorResponse(401, 'unauthorized', 'Not connected to Strava.')
      return await proxyStravaRead({
        path: '/athlete/activities',
        request,
        search: activityListSearch(url),
      })
    }

    const streams = /^activities\/([^/]+)\/streams$/.exec(path)
    if (streams) {
      if (request.method !== 'GET') return methodNotAllowed('GET')
      if (!hasBearer(request)) return errorResponse(401, 'unauthorized', 'Not connected to Strava.')
      const activityId = streams[1]
      if (!ACTIVITY_ID_PATTERN.test(activityId)) {
        return errorResponse(400, 'invalid_request', 'That activity id is not valid.')
      }
      return await proxyStravaRead({
        path: `/activities/${activityId}/streams`,
        request,
        // `key_by_type=true` gives a keyed object instead of an array, which is
        // what streamsToTrackpoints.js reads. No `resolution`: any value at all
        // makes Strava resample, and the raw stream is the point.
        search: new URLSearchParams({ keys: url.searchParams.get('keys') ?? '', key_by_type: 'true' }),
      })
    }

    return errorResponse(404, 'not_found', 'Unknown Strava endpoint.')
  } catch (error) {
    console.error('strava: unhandled error', error)
    return errorResponse(500, 'internal_error', 'Something went wrong on our side. Please try again later.')
  }
}

function methodNotAllowed(allow) {
  return errorResponse(405, 'method_not_allowed', 'That request used the wrong method.', undefined, { allow })
}
