// Thin wrapper over Cloudflare's native Rate Limiting binding (configured in
// wrangler.jsonc as FEEDBACK_RATE_LIMITER: 5 requests / 60s). Deliberately not
// a hand-rolled KV counter: KV's get-then-put races under concurrency just like
// the thing it would replace, and true atomicity would need a Durable Object —
// disproportionate for a feedback form. The binding's short window is the right
// fit anyway, since Turnstile is the primary human check and this only caps the
// blast radius of a replayed token or a mashed submit button.

/**
 * Fails *open* when the binding is absent (older local runtimes, or a
 * `wrangler dev` without the ratelimits config) — losing the burst cap is
 * acceptable; losing the form entirely in local dev is not. Turnstile still
 * gates every request either way.
 *
 * @param {{FEEDBACK_RATE_LIMITER?: {limit: (options: {key: string}) => Promise<{success: boolean}>}}} env
 * @param {string} key bucket key — CF-Connecting-IP, edge-injected and not client-spoofable
 * @returns {Promise<boolean>} true when the request is allowed through
 */
export async function isWithinRateLimit(env, key) {
  const limiter = env?.FEEDBACK_RATE_LIMITER
  if (!limiter?.limit) return true

  const { success } = await limiter.limit({ key })
  return success === true
}
