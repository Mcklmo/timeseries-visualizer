// Client for POST /api/feedback (served by worker/routes/feedback.js on the
// same origin — no CORS involved).
//
// Deviates from the ActivitySource adapters' throw-on-failure convention on
// purpose: those have exactly one failure mode the UI shows verbatim, whereas
// this form has to tell field-level 422 errors (render inline, next to the
// input) apart from rate-limit/upstream/network errors (render as one banner,
// keep the typed text) — a distinction a single thrown Error carries badly.
export const FEEDBACK_ENDPOINT = '/api/feedback'

/**
 * @typedef {{subject: string, message: string, email?: string, turnstileToken: string, pageUrl: string}} FeedbackSubmission
 * @typedef {{ok: true, issueUrl: string, issueNumber: number}} FeedbackSuccess
 * @typedef {{ok: false, error: string, message: string, fields?: Record<string, string>}} FeedbackFailure
 */

const GENERIC_FAILURE = {
  ok: false,
  error: 'network_error',
  message: 'Could not reach the server. Check your connection and try again.',
}

/**
 * Never rejects — every outcome, including a thrown fetch, comes back as a
 * discriminated result.
 * @param {FeedbackSubmission} submission
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<FeedbackSuccess | FeedbackFailure>}
 */
export async function submitFeedback(submission, fetchImpl = fetch) {
  let response
  try {
    response = await fetchImpl(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submission),
    })
  } catch {
    return GENERIC_FAILURE
  }

  // A proxy or an asset-server fallthrough can answer with HTML instead of the
  // contract — treated as an upstream failure rather than crashing the form.
  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (response.ok && body?.ok === true) {
    return { ok: true, issueUrl: body.issueUrl, issueNumber: body.issueNumber }
  }

  if (body && typeof body.error === 'string') {
    return { ok: false, error: body.error, message: body.message, fields: body.fields }
  }

  return {
    ok: false,
    error: 'unexpected_response',
    message: 'The server returned an unexpected response. Please try again later.',
  }
}
