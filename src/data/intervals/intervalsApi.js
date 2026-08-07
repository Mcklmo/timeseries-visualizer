// Low-level client for intervals.icu's public /api/v1/. The browser talks to
// intervals.icu **directly** — no proxy, no Worker route, no server-side code
// of any kind. That is possible because the API sends CORS headers and
// reflects an arbitrary Origin, with `authorization` in
// access-control-allow-headers. It is the whole reason this feature, unlike
// the feedback form, added nothing to worker/.
//
// **If this feature ever appears to "go offline" for everyone at once, check
// that first.** A CORS refusal and a dead network are indistinguishable from
// here: both surface as a bare TypeError from fetch, so both land on `network`.
//
// Two more consequences of that CORS boundary, both of which look like bugs
// until you know:
//   - No Access-Control-Expose-Headers is sent, so the browser cannot read
//     Content-Disposition (hence no server-supplied filename — see
//     detectActivityFormat.js) or Retry-After / X-RateLimit-*. A 429 gives us
//     a status and nothing else, which is why the rate-limit copy names no
//     wait time.
//   - No Access-Control-Allow-Credentials either, so credentials must be
//     'omit'. 'include' fails outright.
//
// CONVENTION: this throws. The codebase runs two opposite ones —
// ActivitySource adapters throw and ErrorState renders `error.message`
// verbatim, while feedbackClient returns a discriminated result because a 422
// needs a per-field map (see its header). Here there are no per-field errors,
// but the picker does have to tell "your key is no longer valid" from "the
// network failed". So this throws an IntervalsApiError carrying a stable
// `code` alongside a user-facing `message`: the adapter lets it propagate and
// satisfies the port contract unchanged, and the picker catches and switches
// on `.code`. One convention, both needs met.
//
// The API key is a password (see credentialStore.js). It goes in the
// Authorization header and nowhere else — never a query string, never a
// message, never a property of a thrown object.

export const INTERVALS_API_BASE = 'https://intervals.icu/api/v1'

/** Where the athlete gets their key. Linked from the connect form. */
export const INTERVALS_SETTINGS_URL = 'https://intervals.icu/settings'

/**
 * @typedef {'unauthorized'|'forbidden'|'not_found'|'no_original_file'|'unsupported_source'
 *   |'unsupported_format'|'rate_limited'|'network'|'unexpected'} IntervalsErrorCode
 */

/** @type {Record<IntervalsErrorCode, string>} */
const MESSAGE_BY_CODE = {
  unauthorized: "intervals.icu didn't accept that API key.",
  forbidden: "Your account doesn't allow access to that activity.",
  not_found: 'That activity no longer exists on intervals.icu.',
  no_original_file: "intervals.icu doesn't have the original file for that activity.",
  unsupported_source: "Synced from Strava — intervals.icu doesn't keep the original file.",
  unsupported_format: "intervals.icu returned a file this app can't read.",
  rate_limited: 'Too many requests — wait a moment and try again.',
  network: "Couldn't reach intervals.icu.",
  unexpected: 'intervals.icu is having trouble right now.',
}

/** Everything else — including 4xx codes the API doesn't document — is `unexpected`. */
const CODE_BY_STATUS = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  429: 'rate_limited',
}

export class IntervalsApiError extends Error {
  /**
   * @param {IntervalsErrorCode} code
   * @param {string} [message] - defaults to the code's user-facing copy
   */
  constructor(code, message = MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.unexpected) {
    super(message)
    this.name = 'IntervalsApiError'
    this.code = code
  }
}

/**
 * `YYYY-MM-DD` in the **local** calendar, because `oldest`/`newest` are
 * compared against `start_date_local`. `toISOString().slice(0, 10)` is the
 * obvious spelling and is wrong: it is UTC, so it silently shifts the window
 * by a day for anyone not on UTC, dropping or duplicating a day's activities
 * at the boundary.
 * @param {Date} date
 */
export function toApiDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function basicAuthHeader(apiKey) {
  try {
    // Username is the literal string API_KEY; the athlete's key is the
    // password. There is no bearer-token form of this API.
    return `Basic ${btoa(`API_KEY:${apiKey}`)}`
  } catch {
    // btoa rejects anything outside Latin-1. A key with those characters was
    // never a key, so this is reported as the rejection intervals.icu would
    // have answered with rather than escaping as a DOMException.
    throw new IntervalsApiError('unauthorized')
  }
}

/**
 * @param {string} path - already-encoded, relative to INTERVALS_API_BASE
 * @param {{apiKey: string, fetchImpl: typeof fetch, accept?: string, search?: Record<string, string>}} options
 * @returns {Promise<Response>}
 */
async function request(path, { apiKey, fetchImpl, accept = 'application/json', search }) {
  const authorization = basicAuthHeader(apiKey)
  const url = new URL(INTERVALS_API_BASE + path)
  for (const [key, value] of Object.entries(search ?? {})) url.searchParams.set(key, value)

  let response
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      // Nothing outside origin/authorization/accept/content-type/
      // x-requested-with may be sent, or preflight starts failing.
      headers: { authorization, accept },
      credentials: 'omit',
    })
  } catch {
    throw new IntervalsApiError('network')
  }

  if (!response.ok) {
    throw new IntervalsApiError(CODE_BY_STATUS[response.status] ?? 'unexpected')
  }
  return response
}

/** A proxy or an error page can answer with HTML where the contract says JSON. */
async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new IntervalsApiError('unexpected')
  }
}

/**
 * Identity plus key validation in one cheap call. Deliberately not
 * `/athlete/0` — that returns 158 properties including `icu_api_key` itself,
 * i.e. it hands the credential back to us for no reason.
 *
 * `0` is the "me" sentinel for any {athleteId} path segment; there is no /me.
 *
 * @param {{apiKey: string, fetchImpl?: typeof fetch}} options
 */
export async function fetchProfile({ apiKey, fetchImpl = fetch }) {
  return readJson(await request('/athlete/0/profile', { apiKey, fetchImpl }))
}

// Everything a picker row renders, and nothing else — the full activity object
// is ~183 properties, which is a lot to pull over a phone connection N times.
// Safe because the row mapper tolerates every one of these being missing
// anyway (Strava-sourced rows come back as near-empty stubs). If `fields` ever
// misbehaves against the real API, delete the param: nothing else changes.
export const ACTIVITY_LIST_FIELDS = [
  'id',
  'name',
  'type',
  'start_date_local',
  'icu_distance',
  'moving_time',
  'elapsed_time',
  'file_type',
  'source',
  'device_name',
]

/**
 * Activities newest-first. `oldest` is required by the API; `newest` is
 * deliberately never sent — it defaults to now, and passing it explicitly
 * means midnight *at the start* of that day, so `newest=<today>` would drop
 * everything recorded today. Paging therefore widens the window backwards and
 * de-duplicates by id (see IntervalsPage.jsx).
 *
 * @param {{apiKey: string, oldest: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<object[]>}
 */
export async function listActivities({ apiKey, oldest, fetchImpl = fetch }) {
  const response = await request('/athlete/0/activities', {
    apiKey,
    fetchImpl,
    search: { oldest, fields: ACTIVITY_LIST_FIELDS.join(',') },
  })
  const body = await readJson(response)
  return Array.isArray(body) ? body : []
}

/**
 * The **original uploaded file**, gzip-compressed, straight from
 * intervals.icu — no S3 redirect. Deliberately not `/fit-file`, which is
 * intervals.icu's *regenerated* file: its laps come from ICU intervals and
 * anything that didn't survive import is gone. The owner chose original-only
 * fidelity, and that choice is what keeps Stryd developer-field power alive
 * on this path (ARCHITECTURE.md §8).
 *
 * @param {{apiKey: string, activityId: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<Uint8Array>} still gzipped if the browser didn't inflate it
 */
export async function downloadOriginalFile({ apiKey, activityId, fetchImpl = fetch }) {
  const response = await request(`/activity/${encodeURIComponent(activityId)}/file`, {
    apiKey,
    fetchImpl,
    accept: '*/*',
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  // A 200 with no body is what "there is no original for this one" looks like
  // — reported as that, rather than as bytes we failed to recognise.
  if (bytes.length === 0) throw new IntervalsApiError('no_original_file')
  return bytes
}
