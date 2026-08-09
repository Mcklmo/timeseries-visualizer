// POST /api/feedback -> a labelled GitHub issue on this repo.
//
// Order matters and is deliberate: cheap local rejections first, then the rate
// limit, then the two network calls. In particular the rate limiter runs
// *before* Turnstile so a flood can't be turned into a flood of siteverify
// calls, and Turnstile runs before GitHub so only verified humans ever reach
// the PAT.
import { buildIssuePayload } from '../lib/buildIssuePayload.js'
import { createGithubIssue } from '../lib/githubClient.js'
import { errorResponse, jsonResponse } from '../lib/httpResponses.js'
import { isWithinRateLimit } from '../lib/rateLimit.js'
import { validateFeedback } from '../lib/validateFeedback.js'
import { verifyTurnstileToken } from '../lib/verifyTurnstile.js'

// Comfortably above a maxed-out form (4000-char message + 120-char subject)
// and far below anything worth parsing as JSON.
const MAX_BODY_BYTES = 20 * 1024

const RATE_LIMIT_WINDOW_SECONDS = 60

/**
 * Reads the body as text, refusing anything over the cap. `content-length` is
 * checked first (cheap, and the honest case), but it is client-supplied and
 * optional, so the decoded text is re-checked too.
 * @returns {Promise<{ok: true, text: string} | {ok: false}>}
 */
async function readLimitedBody(request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { ok: false }

  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false }
  return { ok: true, text }
}

/**
 * @param {Request} request
 * @param {object} env wrangler vars + secrets + bindings
 */
export async function handleFeedbackRequest(request, env) {
  try {
    if (request.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Send feedback with a POST request.', undefined, {
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

    const validation = validateFeedback(parsed)
    if (!validation.ok) {
      return errorResponse(
        422,
        'invalid_request',
        'Please fix the highlighted fields and try again.',
        validation.fields,
      )
    }
    const { subject, message, email, pageUrl, turnstileToken } = validation.value

    // Edge-injected, so unlike anything in the body it can't be spoofed by the
    // client. Absent only when running outside Cloudflare (e.g. a bare `vite`
    // dev server), where every request then shares one bucket.
    const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'

    if (!(await isWithinRateLimit(env.FEEDBACK_RATE_LIMITER, clientIp))) {
      return errorResponse(
        429,
        'rate_limited',
        'Too many submissions from this connection. Please wait a minute and try again.',
        undefined,
        { 'retry-after': String(RATE_LIMIT_WINDOW_SECONDS) },
      )
    }

    if (!env.TURNSTILE_SECRET_KEY || !env.GITHUB_TOKEN) {
      // Misconfigured deploy (missing `wrangler secret put`) — a server fault,
      // not the reporter's, and not something to describe in detail.
      console.error('feedback: missing TURNSTILE_SECRET_KEY or GITHUB_TOKEN')
      return errorResponse(500, 'internal_error', 'Feedback is temporarily unavailable.')
    }

    const captcha = await verifyTurnstileToken({
      token: turnstileToken,
      secret: env.TURNSTILE_SECRET_KEY,
      remoteIp: clientIp === 'unknown' ? undefined : clientIp,
    })
    if (!captcha.ok) {
      return errorResponse(
        403,
        'captcha_failed',
        'The verification challenge could not be confirmed. Please try again.',
      )
    }

    const payload = buildIssuePayload({
      subject,
      message,
      email,
      pageUrl,
      // Captured here rather than taken from the body: a client is free to lie
      // about both, and the issue metadata is only useful if it's true.
      userAgent: request.headers.get('user-agent') ?? '',
      timestamp: new Date().toISOString(),
    })

    const created = await createGithubIssue({
      owner: env.GITHUB_REPO_OWNER,
      repo: env.GITHUB_REPO_NAME,
      token: env.GITHUB_TOKEN,
      payload,
    })
    if (!created.ok) {
      // Detail stays in the Worker log; the response says nothing about GitHub's
      // reply or the token that produced it.
      console.error(`feedback: github issue creation failed — ${created.detail}`)
      return errorResponse(502, 'upstream_error', 'Could not file the issue right now. Please try again later.')
    }

    return jsonResponse(201, {
      ok: true,
      issueUrl: created.issueUrl,
      issueNumber: created.issueNumber,
    })
  } catch (error) {
    console.error('feedback: unhandled error', error)
    return errorResponse(500, 'internal_error', 'Something went wrong on our side. Please try again later.')
  }
}
