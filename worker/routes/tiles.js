// /api/tiles/:provider/:z/:x/:y.png — the basemap proxy for the route map
// panel.
//
// **WHY A PROXY AT ALL, when the tiles are public and need no secret.** Not for
// authentication: for the athlete's IP address. A browser fetching tiles
// directly from a tile host tells that host "this device, at this address, is
// looking at these coordinates, right now" — which is a location log of the
// user's activities, held by a third party, and it would quietly undo the
// privacy claim the rest of this app is built on. Every request here is issued
// FRESH from the edge with no client header forwarded, so the tile provider
// sees Cloudflare and an identifying User-Agent, and nothing else.
//
// The second reason follows from the first: because the client only ever names
// a provider *id*, the upstream URL template lives here and nowhere in the
// bundle. The proxy cannot be repointed at an arbitrary host by editing
// JavaScript that ships to the browser, and adding satellite imagery later is
// one entry in PROVIDERS plus one in src/map/basemapRegistry.js.
//
// Same discipline as worker/lib/stravaProxy.js, and for the same reasons:
// fresh Request, fresh Response, an explicit allowlist in each direction.
// Spreading the client's headers upstream would forward cookies, `referer` and
// client hints to a third party; spreading the provider's back would forward
// its `set-cookie`.
import { errorResponse } from '../lib/httpResponses.js'
import { isWithinRateLimit } from '../lib/rateLimit.js'

export const TILES_ROUTE_PREFIX = '/api/tiles/'

/**
 * The allowlist. `url` is a template, NOT a base to append a client-supplied
 * path to — every substitution below is an integer this file validated itself,
 * so there is no string from the request that reaches the upstream URL.
 *
 * `maxZoom` is duplicated in src/map/basemapRegistry.js on purpose. The client
 * copy keeps the UI from asking; this one is the enforcement, because the
 * client is not a trust boundary. Keeping them in step is a two-line edit; the
 * alternative — a shared module — would put the upstream host one import away
 * from the bundle, which is the one thing this file exists to prevent.
 */
const PROVIDERS = {
  standard: {
    // CARTO's light-all basemap on OpenStreetMap data — a muted grey basemap
    // rather than standard OSM's coloured one, because a route line has to be
    // the most salient thing on this panel and osm.org's tiles are busy enough
    // to compete with it. CARTO's Basemaps are free for non-commercial use with
    // attribution; osm.org's own tile server explicitly forbids proxying.
    url: (z, x, y) => `https://basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
    maxZoom: 19,
  },
}

/**
 * Tiles are immutable in practice: a given (z, x, y) is re-cut on a cadence of
 * months, and being a week stale costs nothing on a map used to recognise a
 * route. A week of edge cache is what keeps Worker invocations near zero on a
 * repeat view, which is also what keeps this inside CARTO's fair-use terms.
 */
const CACHE_SECONDS = 604800

/**
 * Identifies the app to the tile provider. **Required**, not decoration: both
 * OSM's and CARTO's terms forbid anonymous bulk use, and a missing or generic
 * User-Agent is the documented reason for being blocked outright.
 */
const USER_AGENT = 'ActivityMaxxer/1.0 (+https://activitymaxxer.com)'

/** `content-type` so the image decodes, and the two cache headers so a
 *  revalidating client can be answered 304. Deliberately NOT `set-cookie`, and
 *  not anything the provider chooses to add later — an allowlist stays correct
 *  as the upstream changes, a denylist does not. */
const DOWNSTREAM_HEADERS = ['content-type', 'cache-control', 'etag']

/** z/x/y as written by src/map/tileLoader.js. Anchored, digits only, and with
 *  no leading zeros or signs, so `parseInt` cannot disagree with the pattern
 *  about what the string meant. */
const TILE_PATH = /^([a-z0-9-]+)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.png$/

/**
 * A validated tile coordinate, or null.
 *
 * **Every rejection here is a 400 and never a pass-through.** This is the only
 * place a client-supplied value reaches an upstream URL, so it is the only
 * place a path-traversal or SSRF attempt could land — and the `z` bound is not
 * merely hygiene either: an unbounded z is an unbounded number of distinct
 * upstream URLs, i.e. a cache-busting amplifier pointed at someone else's
 * server under our User-Agent.
 *
 * @param {string} path - everything after TILES_ROUTE_PREFIX
 * @returns {{provider: object, z: number, x: number, y: number}|null}
 */
export function parseTilePath(path) {
  const match = TILE_PATH.exec(path)
  if (!match) return null

  const provider = PROVIDERS[match[1]]
  if (!provider) return null

  const z = Number(match[2])
  const x = Number(match[3])
  const y = Number(match[4])
  if (z > provider.maxZoom) return null

  // The grid at zoom z is 2^z × 2^z. Out-of-range coordinates are a 404 at
  // every provider, so answering them ourselves costs an upstream request and
  // tells the caller something more useful.
  const n = 2 ** z
  if (x >= n || y >= n) return null

  return { provider, z, x, y }
}

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
 * @param {Request} request
 * @param {object} env wrangler vars + secrets + bindings
 * @param {typeof fetch} [fetchImpl] injected in tests, matching stravaProxy.js
 */
export async function handleTilesRequest(request, env, fetchImpl = fetch) {
  try {
    if (request.method !== 'GET') {
      return errorResponse(405, 'method_not_allowed', 'That request used the wrong method.', undefined, {
        allow: 'GET',
      })
    }

    const url = new URL(request.url)
    const tile = parseTilePath(url.pathname.slice(TILES_ROUTE_PREFIX.length))
    if (!tile) return errorResponse(400, 'invalid_request', 'That is not a tile this app serves.')

    // Cheap local rejection first, then the limiter, then the network — the
    // same order feedback.js and strava.js use. Nothing reaches a third party
    // that this Worker could have refused itself.
    const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
    if (!(await isWithinRateLimit(env?.TILES_RATE_LIMITER, clientIp))) {
      return errorResponse(429, 'app_rate_limited', 'Too many map requests from this connection.')
    }

    let upstream
    try {
      upstream = await fetchImpl(tile.provider.url(tile.z, tile.x, tile.y), {
        // NO client headers, in either direction — see the file header. This is
        // the line that keeps the athlete's IP address away from the provider.
        headers: { accept: 'image/*', 'user-agent': USER_AGENT },
        // Cloudflare's edge cache. Without it every viewer of every activity is
        // a fresh origin fetch, which is both slow and the kind of volume the
        // providers' terms are about.
        cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
      })
    } catch (error) {
      console.error(`tiles: upstream request failed — ${error.message}`)
      return errorResponse(502, 'upstream_unreachable', "Couldn't reach the map provider.")
    }

    if (!upstream.ok) {
      // The provider's own body is never returned: on an error it is HTML, and
      // the client is expecting an image. A tile that will not load is a blank
      // square, which the client already handles.
      return errorResponse(502, 'upstream_error', "The map provider didn't return that tile.")
    }

    const headers = copyAllowed(upstream.headers, DOWNSTREAM_HEADERS)
    // Set AFTER the copy so it wins over whatever the provider sent: their
    // policy is tuned for their own CDN, ours for a tile that is effectively
    // immutable and served from our edge cache.
    headers.set('cache-control', `public, max-age=${CACHE_SECONDS}, immutable`)
    return new Response(upstream.body, { status: 200, headers })
  } catch (error) {
    console.error('tiles: unhandled error', error)
    return errorResponse(500, 'internal_error', 'Something went wrong on our side. Please try again later.')
  }
}
