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
//     data/fileFormat.js) or Retry-After / X-RateLimit-*. A 429 gives us
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

// `toApiDate` used to live here, next to the endpoints whose `oldest`/`newest`
// params it formats. It is in data/activityDateRange.js now: both its consumers
// are date-range concerns, and this import was the only thing keeping that
// otherwise provider-neutral module inside data/intervals/.

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
 * optional and, left out, defaults to now — which is what the rolling browse
 * window relies on, since it widens backwards and de-duplicates by id (see
 * IntervalsPage.jsx).
 *
 * **`newest=<day>` means midnight at the *start* of that day**, so it excludes
 * everything recorded on the day it names — `newest=<today>` would drop
 * today's ride. Callers therefore must pass the day *after* the last day they
 * want included; `requestBoundsFor` in activityDateRange.js is the only caller
 * that sends it and exists largely to get that `+ 1 day` right in one place.
 *
 * @param {{apiKey: string, oldest: string, newest?: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<object[]>}
 */
export async function listActivities({ apiKey, oldest, newest, fetchImpl = fetch }) {
  const response = await request('/athlete/0/activities', {
    apiKey,
    fetchImpl,
    // Set only when given: an explicit `newest` is never equivalent to the
    // default, and a stray `undefined` would go over the wire as the string.
    search: { oldest, ...(newest ? { newest } : {}), fields: ACTIVITY_LIST_FIELDS.join(',') },
  })
  const body = await readJson(response)
  return Array.isArray(body) ? body : []
}

/** Enough to fill a phone screen twice; the endpoint has no paging. */
export const ACTIVITY_SEARCH_LIMIT = 30

/**
 * Name search across the athlete's **whole history**, not the browsed window
 * — neither search endpoint accepts `oldest`/`newest`, which is the entire
 * point of having this alongside listActivities.
 *
 * Deliberately `/search-full` rather than `/search`, despite the ~183-property
 * rows: the lighter `ActivitySearchResult` omits `source`, `file_type` and
 * `device_name` — exactly the three the picker needs to grey out Strava rows
 * up front (unsupportedReason) and to credit Garmin (API Terms §1.1) — and it
 * names distance `distance` where every row renderer here reads
 * `icu_distance`. So the light endpoint costs a second request per row's worth
 * of truth and a divergent row shape; this one renders through the browse
 * list's code unchanged.
 *
 * There is **no `fields` param on this endpoint** (unlike /activities), so
 * ACTIVITY_LIST_FIELDS deliberately does not apply here and rows arrive
 * full-fat. That is a knowing cost, not an oversight — do not "fix" it by
 * passing `fields`; the spec does not document it here.
 *
 * A `q` that starts with `#` is an **exact tag search**, per the API. That is
 * free behaviour through the same input, which is why there is no tag UI on
 * this side and no `#` handling in the caller.
 *
 * @param {{apiKey: string, query: string, limit?: number, fetchImpl?: typeof fetch}} options
 * @returns {Promise<object[]>}
 */
export async function searchActivities({
  apiKey,
  query,
  limit = ACTIVITY_SEARCH_LIMIT,
  fetchImpl = fetch,
}) {
  const response = await request('/athlete/0/activities/search-full', {
    apiKey,
    fetchImpl,
    search: { q: query, limit: String(limit) },
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
