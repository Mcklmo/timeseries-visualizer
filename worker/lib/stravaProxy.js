// Forwards a read request to Strava's API and hands the answer back unchanged.
//
// **Design principle: the body is Strava's, verbatim.** The client in
// `src/data/strava/` is written against *Strava's* wire shape, not a bespoke
// one this Worker invented. Two payoffs. If Strava's CORS ever becomes reliable
// on these endpoints, going direct from the browser is changing one base-URL
// constant and deleting a file — not rewriting a client. And nothing here has
// to be kept in sync with Strava's schema, which means nothing here can drift
// out of sync with it. Only the Worker's *own* failures use httpResponses.js's
// `{ok:false, error, message}` envelope, which is exactly how the client tells
// "our proxy said no" from "Strava said no".
//
// **The Worker is stateless.** It holds the client secret and forwards the
// browser's bearer token upstream. It never stores an athlete token, and it
// never touches KV, D1 or a Durable Object — which makes API Policy §6.3
// (delete within 48h of a user action) and §7.4 (within 30 days of revocation)
// trivially satisfied on this side: there is nothing here to delete. The honest
// cost, which belongs in the user-facing copy rather than only in this comment:
// the athlete's token transits this Worker in a request header and their
// telemetry in a response body. Same-origin HTTPS, never logged, never
// persisted.
//
// **Fresh Request and fresh Response, both directions, always.** Spreading the
// client's headers into the upstream call would forward cookies, `origin`,
// `referer`, client hints and anything else a browser or an extension chose to
// attach — to a third party, under the athlete's bearer token. Spreading
// Strava's response headers back would forward its `set-cookie`. Two
// allowlists, no exceptions; adding a header is a deliberate edit here.
export const STRAVA_API_BASE = 'https://www.strava.com/api/v3'

/** Everything Strava needs from the client and nothing else. `authorization`
 *  is the athlete's bearer token; `accept` pins JSON. */
const UPSTREAM_HEADERS = ['authorization', 'accept']

/**
 * What the browser gets back. `content-type` so `response.json()` works, plus
 * Strava's four rate-limit counters — which are readable client-side **for
 * free** here, because this is a same-origin response. The intervals.icu path
 * cannot read its equivalents at all (no Access-Control-Expose-Headers), which
 * is why its rate-limit copy can name no wait time and Strava's can.
 *
 * Deliberately NOT forwarded: `set-cookie` above all, but also `date`,
 * `server`, and anything else Strava chooses to add later — an allowlist stays
 * correct as the upstream changes, a denylist does not.
 */
const DOWNSTREAM_HEADERS = [
  'content-type',
  'x-ratelimit-limit',
  'x-ratelimit-usage',
  'x-readratelimit-limit',
  'x-readratelimit-usage',
]

/** @param {Headers} from @param {string[]} allowed */
function copyAllowed(from, allowed) {
  const headers = new Headers()
  for (const name of allowed) {
    const value = from.get(name)
    if (value !== null) headers.set(name, value)
  }
  return headers
}

/**
 * GETs `path` on Strava's API with the client's bearer token, and returns
 * Strava's status and body untouched.
 *
 * A transport failure becomes a 502 with our envelope rather than an
 * exception: to the browser, "Strava is unreachable" and "Strava said no" have
 * to be different answers, and only one of them is worth retrying.
 *
 * @param {object} input
 * @param {string} input.path already-encoded, relative to STRAVA_API_BASE
 * @param {Request} input.request the client's request, read for headers only
 * @param {URLSearchParams} [input.search]
 * @param {typeof fetch} [input.fetchImpl]
 * @returns {Promise<Response>}
 */
export async function proxyStravaRead({ path, request, search, fetchImpl = fetch }) {
  const url = new URL(STRAVA_API_BASE + path)
  for (const [key, value] of search ?? []) url.searchParams.set(key, value)

  let upstream
  try {
    upstream = await fetchImpl(
      new Request(url.toString(), {
        method: 'GET',
        headers: copyAllowed(request.headers, UPSTREAM_HEADERS),
      }),
    )
  } catch (error) {
    // Detail stays server-side; the route's caller gets the envelope.
    console.error(`strava: upstream request failed — ${error.message}`)
    return new Response(
      JSON.stringify({ ok: false, error: 'upstream_unreachable', message: "Couldn't reach Strava." }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }

  // Status and body pass through untouched — including 401 and 429, which the
  // client maps to its own codes. Rewriting them here would flatten exactly
  // the distinction the client needs.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: copyAllowed(upstream.headers, DOWNSTREAM_HEADERS),
  })
}
