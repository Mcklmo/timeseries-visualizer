// Thin wrapper over Cloudflare's native Rate Limiting binding. Deliberately not
// a hand-rolled KV counter: KV's get-then-put races under concurrency just like
// the thing it would replace, and true atomicity would need a Durable Object —
// disproportionate for either caller here. The binding's short window is the
// right fit anyway: neither route is relying on it as the primary defence.
//
// **The binding is passed in, not looked up.** It used to read
// `env.FEEDBACK_RATE_LIMITER` itself, which stopped working the moment a second
// route needed its own bucket (`env.STRAVA_RATE_LIMITER`). One limiter per
// route, one function.
//
// **WHAT THIS CANNOT DO, and nobody should read it as doing.** Cloudflare's
// binding accepts a `period` of 10 or 60 seconds and nothing else, and its
// counters are per-colo and eventually consistent — Cloudflare's own docs say
// it is "intentionally designed to not be used as an accurate accounting
// system". So it is a per-IP **burst cap**, full stop. It cannot express
// Strava's "2,000 reads/day", it cannot express any per-application budget
// (this is per-IP, and Strava's limits are per-app across every athlete), and
// it will let some requests through past its own nominal limit. The app-wide
// daily budget is *observed* via the X-ReadRateLimit-Usage header Strava
// returns, never enforced here.

/**
 * Fails *open* when the binding is absent (older local runtimes, or a
 * `wrangler dev` without the ratelimits config) — losing a burst cap is
 * acceptable; losing the feature entirely in local dev is not.
 *
 * @param {{limit: (options: {key: string}) => Promise<{success: boolean}>}|undefined} limiter
 *   the rate-limit binding off `env`, e.g. `env.FEEDBACK_RATE_LIMITER`
 * @param {string} key bucket key — CF-Connecting-IP, edge-injected and not client-spoofable
 * @returns {Promise<boolean>} true when the request is allowed through
 */
export async function isWithinRateLimit(limiter, key) {
  if (!limiter?.limit) return true

  const { success } = await limiter.limit({ key })
  return success === true
}
