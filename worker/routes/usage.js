// POST /api/usage — receives the anonymous per-page-load feature flags that
// src/lib/usage.js sends with `navigator.sendBeacon` as a tab is hidden.
//
// Cheap rejections first, feedback.js's order: method, rate limit, body size,
// shape. Ids outside shared/usageEvents.js's allowlist are dropped one by one
// rather than failing the whole body, so an old tab still open across a
// deploy that retired a feature id loses only that id.
//
// **The answer is always 204 on success and says nothing.** sendBeacon never
// reads a response, and an endpoint whose body carried anything would invite
// someone to start depending on it.
import {
  USAGE_FEATURES,
  USAGE_MAX_BODY_BYTES,
  USAGE_PAYLOAD_VERSION,
  isUsageFeature,
} from '../../shared/usageEvents.js'
import { errorResponse } from '../lib/httpResponses.js'
import { isWithinRateLimit } from '../lib/rateLimit.js'
import { deviceClass, recordFeatures } from '../lib/usageAnalytics.js'

/**
 * @param {unknown} body parsed JSON
 * @returns {string[]|null} the unique, allowed ids, or null for a malformed body
 */
export function parseUsageBody(body) {
  if (!body || typeof body !== 'object' || body.v !== USAGE_PAYLOAD_VERSION) return null
  if (!Array.isArray(body.f) || body.f.length > USAGE_FEATURES.length) return null
  return [...new Set(body.f.filter(isUsageFeature))]
}

/**
 * @param {Request} request
 * @param {object} env
 */
export async function handleUsageRequest(request, env) {
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Use POST', undefined, { allow: 'POST' })
  }

  // The IP is the rate limiter's bucket key and nothing more — it is not
  // passed to, or stored by, anything below.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (!(await isWithinRateLimit(env.USAGE_RATE_LIMITER, ip))) {
    return errorResponse(429, 'rate_limited', 'Too many requests')
  }

  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > USAGE_MAX_BODY_BYTES) {
    return errorResponse(413, 'payload_too_large', 'Body too large')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).length > USAGE_MAX_BODY_BYTES) {
    return errorResponse(413, 'payload_too_large', 'Body too large')
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return errorResponse(400, 'invalid_body', 'Body must be JSON')
  }
  const features = parseUsageBody(parsed)
  if (!features) return errorResponse(400, 'invalid_body', 'Unrecognised usage payload')

  recordFeatures(env, features, deviceClass(request.headers))
  return new Response(null, { status: 204 })
}
