// Client for POST /api/share (served by worker/routes/share.js on the same
// origin) — trades the multi-KB hash payload for a ~45-char short link.
//
// **Every failure is a silent `{ok: false}`, and that is the whole design.**
// The caller (ShareActivityButton) holds a long URL that works without any
// server at all — the serverless promise issue #4 starts from — so a failed
// shorten degrades to sharing that instead of surfacing an error for a step
// the user never asked for by name. Same never-rejects shape as
// feedbackClient.js, minus the field errors it has no use for.
export const SHARE_ENDPOINT = '/api/share'

/**
 * @param {string} payload the encoded share payload (shareCodec.js)
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ok: true, id: string} | {ok: false}>}
 */
export async function createShortShareLink(payload, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(SHARE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    })
    const body = await response.json()
    if (response.ok && body?.ok === true && typeof body.id === 'string' && body.id.length > 0) {
      return { ok: true, id: body.id }
    }
  } catch {
    // Offline, a proxy answering HTML, a dev server without the Worker —
    // all the same case: no short link today.
  }
  return { ok: false }
}
