// Cloudflare Turnstile server-side verification — the "is this a human" gate.
// The rate limiter (rateLimit.js) is only a blast-radius cap behind this.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Fails closed: a network error or a non-2xx from Cloudflare resolves to
 * `{ok: false}` rather than throwing, so the caller has one branch to handle
 * and an outage can never wave a submission through.
 *
 * `fetchImpl` is injected (defaulting to the platform `fetch`) purely so tests
 * can assert the request shape without a network stub — same pattern as
 * githubClient.js.
 *
 * @param {object} input
 * @param {string} input.token the `cf-turnstile-response` token from the widget
 * @param {string} input.secret TURNSTILE_SECRET_KEY (wrangler secret / .dev.vars)
 * @param {string} [input.remoteIp] CF-Connecting-IP, edge-injected
 * @param {typeof fetch} [input.fetchImpl]
 * @returns {Promise<{ok: boolean, errorCodes: string[]}>}
 */
export async function verifyTurnstileToken({ token, secret, remoteIp, fetchImpl = fetch }) {
  const payload = { secret, response: token }
  if (remoteIp) payload.remoteip = remoteIp

  let response
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, errorCodes: ['network-error'] }
  }

  if (!response.ok) return { ok: false, errorCodes: ['siteverify-http-error'] }

  let result
  try {
    result = await response.json()
  } catch {
    return { ok: false, errorCodes: ['siteverify-malformed-response'] }
  }

  return {
    ok: result?.success === true,
    errorCodes: Array.isArray(result?.['error-codes']) ? result['error-codes'] : [],
  }
}
