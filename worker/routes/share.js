// The share-link shortener: POST /api/share stores a codec payload in Workers
// KV, GET /s/<id> redirects to the hash URL that carries it. The other half of
// src/data/shared/shareCodec.js — that codec is the product; this route only
// makes its multi-KB URLs travel through messaging apps, which truncate them.
//
// **The whole feature is optional at runtime, and the client knows it.** With
// no SHARE_LINKS binding (the KV block in wrangler.jsonc is commented out
// until the namespace is provisioned) the POST answers 503 and the client
// silently falls back to the self-contained `#a=` URL — issue #4's serverless
// promise stays intact with the server contributing nothing but brevity.
//
// **Content-addressed ids, not random ones.** The id is the first 10 base64url
// chars of SHA-256(payload): 60 bits — unguessable in practice, so a stored
// route is exactly as private as any unlisted link — and deterministic, so
// re-sharing the same activity re-writes the same key instead of growing the
// namespace, and a replayed POST is idempotent by construction.
//
// **The payload is stored opaque, never decoded here.** Only clients decode
// share payloads, and they treat every one as attacker-controlled (the codec's
// validation section) — a Worker-side decode would double that logic for no
// added safety. What this route enforces is shape and cost: the codec's own
// charset and size cap, a body cap, and a per-IP rate limit, in feedback.js's
// cheap-rejections-first order.
//
// **GET lands inside the app** (`/#a=<payload>` or `/#a=missing`), so the
// client has exactly one loading mechanism. A link with a stored preview image
// answers with a stub page instead of a 302: scrapers never see the hash, so
// the og:image has to come from this URL, and the script moves people on.
import { errorResponse, jsonResponse } from '../lib/httpResponses.js'
import { isWithinRateLimit } from '../lib/rateLimit.js'

export const SHARE_API_PATH = '/api/share'
export const SHARE_LINK_PREFIX = '/s/'

// Mirrors SHARE_URL_MAX_CHARS in src/data/shared/shareCodec.js — the codec
// never produces a longer payload, so anything longer is not the codec's.
// Duplicated rather than imported: worker/ deliberately imports nothing from
// src/ (only /shared is two-sided), and this number changes together with the
// codec's or not at all.
const MAX_PAYLOAD_CHARS = 32000

// A version digit, then the codec's base64url alphabet. `[0-9]` rather than
// `1` so a future payload version needs no Worker deploy to become storable.
const PAYLOAD_PATTERN = /^[0-9][A-Za-z0-9_-]+$/

// A 1200x630 line chart is ~100-200 KB of PNG.
const MAX_IMAGE_CHARS = 500 * 1024
const IMAGE_PATTERN = /^iVBORw0KGg[A-Za-z0-9+/]+={0,2}$/ // PNG magic, base64
const IMAGE_KEY_PREFIX = 'img:'
const IMAGE_SUFFIX = '.png'

// The JSON envelope around a maxed-out payload and image, with headroom.
const MAX_BODY_BYTES = MAX_IMAGE_CHARS + 40 * 1024

const ID_LENGTH = 10
const ID_PATTERN = /^[A-Za-z0-9_-]{10}$/

// A hit is immutable (content-addressed), so let browsers and the edge keep
// the redirect for a day; a miss can become a hit the moment someone shares
// that activity, so it must not be cached at all.
const HIT_CACHE_SECONDS = 86400

/** First 10 base64url chars of SHA-256(payload) — 60 bits of id. */
export async function shareIdFor(payload) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').slice(0, ID_LENGTH)
}

/** Same cap-then-recheck body reader as feedback.js — content-length is
 *  client-supplied and optional, so the decoded text is measured too. */
async function readLimitedBody(request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { ok: false }

  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false }
  return { ok: true, text }
}

/**
 * POST /api/share -> {ok: true, id}
 * @param {Request} request
 * @param {object} env wrangler vars + secrets + bindings
 */
export async function handleShareRequest(request, env) {
  try {
    if (request.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Create a share link with a POST request.', undefined, {
        allow: 'POST',
      })
    }

    const body = await readLimitedBody(request)
    if (!body.ok) {
      return errorResponse(400, 'invalid_json', 'That request was too large to process.')
    }

    let parsed
    try {
      parsed = JSON.parse(body.text)
    } catch {
      return errorResponse(400, 'invalid_json', 'That request could not be read.')
    }

    const payload = parsed?.payload
    if (
      typeof payload !== 'string' ||
      payload.length < 2 ||
      payload.length > MAX_PAYLOAD_CHARS ||
      !PAYLOAD_PATTERN.test(payload)
    ) {
      return errorResponse(422, 'invalid_request', 'That is not a share payload this app produces.')
    }

    const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
    if (!(await isWithinRateLimit(env?.SHARE_RATE_LIMITER, clientIp))) {
      return errorResponse(429, 'rate_limited', 'Too many share links from this connection. Please wait a minute.')
    }

    if (!env?.SHARE_LINKS) {
      // Not an error worth alarming anyone over: the binding is opt-in (see
      // the header), and the client's fallback long URL works without it.
      return errorResponse(503, 'shortener_unavailable', 'Short share links are not enabled on this deployment.')
    }

    const id = await shareIdFor(payload)
    await env.SHARE_LINKS.put(id, payload)

    const image = parsed.image
    if (typeof image === 'string' && image.length <= MAX_IMAGE_CHARS && IMAGE_PATTERN.test(image)) {
      // First write wins: the image is not part of the id, so anyone holding the
      // link could otherwise replace its preview.
      const key = IMAGE_KEY_PREFIX + id
      if (!(await env.SHARE_LINKS.get(key))) await env.SHARE_LINKS.put(key, image)
    }
    return jsonResponse(201, { ok: true, id })
  } catch (error) {
    console.error('share: unhandled error', error)
    return errorResponse(500, 'internal_error', 'Something went wrong on our side. Please try again later.')
  }
}

/**
 * GET /s/<id> -> into the app, carrying the payload (or `missing`) in the
 * hash. GET /s/<id>.png -> that link's preview image. See the module header.
 * @param {Request} request
 * @param {object} env
 */
export async function handleShareLinkRequest(request, env) {
  try {
    if (request.method !== 'GET') {
      return errorResponse(405, 'method_not_allowed', 'That request used the wrong method.', undefined, {
        allow: 'GET',
      })
    }

    const url = new URL(request.url)
    const path = url.pathname.slice(SHARE_LINK_PREFIX.length)
    if (path.endsWith(IMAGE_SUFFIX)) return previewImage(path.slice(0, -IMAGE_SUFFIX.length), env)

    const id = path
    const payload = ID_PATTERN.test(id) ? await env?.SHARE_LINKS?.get(id) : null

    if (typeof payload !== 'string' || !PAYLOAD_PATTERN.test(payload)) {
      // Malformed id, no binding, an expired entry, or (never, absent a KV
      // write outside this route) a stored value that isn't a payload — one
      // answer: the app's own "link could not be found" state.
      return new Response(null, {
        status: 302,
        headers: { location: '/#a=missing', 'cache-control': 'no-store' },
      })
    }

    if (await env.SHARE_LINKS.get(IMAGE_KEY_PREFIX + id)) {
      return new Response(previewPage(`${url.origin}${SHARE_LINK_PREFIX}${id}`, payload), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': `public, max-age=${HIT_CACHE_SECONDS}`,
        },
      })
    }

    return new Response(null, {
      status: 302,
      headers: {
        location: `/#a=${payload}`,
        'cache-control': `public, max-age=${HIT_CACHE_SECONDS}`,
      },
    })
  } catch (error) {
    console.error('share: unhandled error', error)
    return errorResponse(500, 'internal_error', 'Something went wrong on our side. Please try again later.')
  }
}

async function previewImage(id, env) {
  const image = ID_PATTERN.test(id) ? await env?.SHARE_LINKS?.get(IMAGE_KEY_PREFIX + id) : null
  if (!image) return errorResponse(404, 'not_found', 'There is no preview for that link.')
  return new Response(Uint8Array.from(atob(image), (c) => c.charCodeAt(0)), {
    headers: {
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'cache-control': `public, max-age=${HIT_CACHE_SECONDS}`,
    },
  })
}

/** `payload` has passed PAYLOAD_PATTERN, so it is inert inside the markup. */
function previewPage(linkUrl, payload) {
  const title = 'Activity on ActivityMaxxer'
  const description = 'Pace, heart rate, cadence, power and elevation as stacked, time-synced charts.'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ActivityMaxxer">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${linkUrl}">
<meta property="og:image" content="${linkUrl}${IMAGE_SUFFIX}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script>location.replace('/#a=${payload}')</script>
</head>
<body><a href="/#a=${payload}">Open this activity</a></body>
</html>
`
}
