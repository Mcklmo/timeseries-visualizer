import { describe, it, expect, vi } from 'vitest'
import { submitFeedback } from './feedbackClient.js'

const submission = {
  subject: 'Cadence panel is blank',
  message: 'The cadence chart renders nothing for my FIT export.',
  email: '',
  turnstileToken: 'token-abc',
  pageUrl: 'https://example.com/',
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('submitFeedback', () => {
  it('POSTs the submission as JSON to the same-origin endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, issueUrl: 'u', issueNumber: 1 }))

    await submitFeedback(submission, fetchImpl)

    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(options.method).toBe('POST')
    expect(options.headers['content-type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual(submission)
  })

  it('resolves the created issue on 201', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        ok: true,
        issueUrl: 'https://github.com/Mcklmo/timeseries-visualizer/issues/42',
        issueNumber: 42,
      }),
    )

    await expect(submitFeedback(submission, fetchImpl)).resolves.toEqual({
      ok: true,
      issueUrl: 'https://github.com/Mcklmo/timeseries-visualizer/issues/42',
      issueNumber: 42,
    })
  })

  it('passes through the per-field map from a 422 — the reason this returns instead of throwing', async () => {
    const fields = { subject: 'Too short.' }
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { ok: false, error: 'invalid_request', message: 'Fix them.', fields }))

    await expect(submitFeedback(submission, fetchImpl)).resolves.toEqual({
      ok: false,
      error: 'invalid_request',
      message: 'Fix them.',
      fields,
    })
  })

  it.each([
    [429, 'rate_limited'],
    [403, 'captcha_failed'],
    [502, 'upstream_error'],
    [500, 'internal_error'],
  ])('passes through the %i error code as a fieldless failure', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { ok: false, error: code, message: 'nope' }))

    await expect(submitFeedback(submission, fetchImpl)).resolves.toEqual({
      ok: false,
      error: code,
      message: 'nope',
      fields: undefined,
    })
  })

  it('reports a network failure instead of rejecting', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(submitFeedback(submission, fetchImpl)).resolves.toMatchObject({
      ok: false,
      error: 'network_error',
    })
  })

  it('reports a non-JSON response (e.g. an HTML error page) instead of crashing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>gateway timeout</html>', { status: 504 }))

    await expect(submitFeedback(submission, fetchImpl)).resolves.toMatchObject({
      ok: false,
      error: 'unexpected_response',
    })
  })

  it('does not report success for a 200 that lacks the ok flag', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { issueNumber: 42 }))

    await expect(submitFeedback(submission, fetchImpl)).resolves.toMatchObject({ ok: false })
  })
})
