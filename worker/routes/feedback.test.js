// Route-level tests drive the *real* chain (validate -> rate limit -> Turnstile
// -> GitHub) and stub only the outermost edge: `globalThis.fetch`, routed by
// URL. Mocking the lib modules instead would assert that the route calls them,
// not that the thing it produces is right — see README "Testing notes".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleFeedbackRequest } from './feedback.js'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const ISSUES_API = 'https://api.github.com/repos/Mcklmo/timeseries-visualizer/issues'

const validSubmission = {
  subject: 'Cadence panel is blank',
  message: 'The cadence chart renders nothing for my FIT export.',
  email: 'runner@example.com',
  turnstileToken: 'token-abc',
  pageUrl: 'https://example.com/',
}

function makeEnv(overrides = {}) {
  return {
    GITHUB_TOKEN: 'github_pat_example',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    GITHUB_REPO_OWNER: 'Mcklmo',
    GITHUB_REPO_NAME: 'timeseries-visualizer',
    FEEDBACK_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  }
}

function makeRequest(body = validSubmission, init = {}) {
  return new Request('https://example.com/api/feedback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      'user-agent': 'Mozilla/5.0 (Macintosh)',
      ...init.headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
}

/** Stubs global fetch, routing by URL — siteverify vs. the GitHub issues API. */
function stubFetch({ captchaOk = true, githubStatus = 201 } = {}) {
  const calls = []
  const impl = vi.fn(async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url) === SITEVERIFY) {
      return new Response(JSON.stringify({ success: captchaOk, 'error-codes': captchaOk ? [] : ['invalid-input-response'] }))
    }
    if (String(url) === ISSUES_API) {
      if (githubStatus !== 201) return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: githubStatus })
      return new Response(
        JSON.stringify({
          number: 42,
          html_url: 'https://github.com/Mcklmo/timeseries-visualizer/issues/42',
        }),
        { status: 201 },
      )
    }
    throw new Error(`unexpected fetch to ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return { calls, impl }
}

// The route logs upstream/config faults on purpose; keep the test output clean
// without losing the assertion that it happened.
let consoleError

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  consoleError.mockRestore()
})

describe('handleFeedbackRequest — happy path', () => {
  it('creates a labelled GitHub issue and returns 201 with its number and URL', async () => {
    const { calls } = stubFetch()

    const response = await handleFeedbackRequest(makeRequest(), makeEnv())

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      issueUrl: 'https://github.com/Mcklmo/timeseries-visualizer/issues/42',
      issueNumber: 42,
    })

    const issueCall = calls.find((call) => call.url === ISSUES_API)
    const payload = JSON.parse(issueCall.options.body)
    expect(payload.title).toBe('Cadence panel is blank')
    expect(payload.labels).toEqual(['feedback'])
    expect(payload.body).toContain(validSubmission.message)
    expect(payload.body).toContain('- Reporter email: `runner@example.com`')
  })

  it('captures the user agent and timestamp server-side, ignoring any the client sent', async () => {
    const { calls } = stubFetch()

    const response = await handleFeedbackRequest(
      makeRequest({ ...validSubmission, userAgent: 'SPOOFED', timestamp: '1999-01-01T00:00:00.000Z' }),
      makeEnv(),
    )
    expect(response.status).toBe(201)

    const payload = JSON.parse(calls.find((call) => call.url === ISSUES_API).options.body)
    expect(payload.body).toContain('- User agent: `Mozilla/5.0 (Macintosh)`')
    expect(payload.body).not.toContain('SPOOFED')
    expect(payload.body).not.toContain('1999-01-01')
  })

  it('verifies the captcha before ever reaching GitHub', async () => {
    const { calls } = stubFetch()

    await handleFeedbackRequest(makeRequest(), makeEnv())

    expect(calls.map((call) => call.url)).toEqual([SITEVERIFY, ISSUES_API])
    expect(JSON.parse(calls[0].options.body)).toMatchObject({
      secret: 'turnstile-secret',
      response: 'token-abc',
      remoteip: '203.0.113.7',
    })
  })
})

describe('handleFeedbackRequest — rejections', () => {
  it('405s a non-POST request', async () => {
    stubFetch()

    const response = await handleFeedbackRequest(
      new Request('https://example.com/api/feedback', { method: 'GET' }),
      makeEnv(),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'method_not_allowed' })
  })

  it('400s an unparseable body', async () => {
    stubFetch()

    const response = await handleFeedbackRequest(makeRequest('{not json'), makeEnv())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_json' })
  })

  it('400s an oversized body without parsing it', async () => {
    const { impl } = stubFetch()

    const response = await handleFeedbackRequest(
      makeRequest({ ...validSubmission, message: 'x'.repeat(30_000) }),
      makeEnv(),
    )

    expect(response.status).toBe(400)
    expect(impl).not.toHaveBeenCalled()
  })

  it('422s validation failures with a per-field map, before any network call', async () => {
    const { impl } = stubFetch()

    const response = await handleFeedbackRequest(
      makeRequest({ ...validSubmission, subject: '', message: '' }),
      makeEnv(),
    )

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.error).toBe('invalid_request')
    expect(Object.keys(body.fields).sort()).toEqual(['message', 'subject'])
    expect(impl).not.toHaveBeenCalled()
  })

  it('429s when the rate limiter rejects, before spending a siteverify call', async () => {
    const { impl } = stubFetch()
    const env = makeEnv({ FEEDBACK_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } })

    const response = await handleFeedbackRequest(makeRequest(), env)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toMatchObject({ error: 'rate_limited' })
    expect(env.FEEDBACK_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
    expect(impl).not.toHaveBeenCalled()
  })

  it('403s a failed captcha without reaching GitHub', async () => {
    const { calls } = stubFetch({ captchaOk: false })

    const response = await handleFeedbackRequest(makeRequest(), makeEnv())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'captcha_failed' })
    expect(calls.map((call) => call.url)).toEqual([SITEVERIFY])
  })

  it('502s a GitHub failure without leaking its error body or the token', async () => {
    stubFetch({ githubStatus: 401 })

    const response = await handleFeedbackRequest(makeRequest(), makeEnv())

    expect(response.status).toBe(502)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: 'upstream_error' })
    expect(text).not.toContain('Bad credentials')
    expect(text).not.toContain('github_pat_example')
    expect(consoleError).toHaveBeenCalled()
  })

  it('500s (without describing why) when the deploy is missing its secrets', async () => {
    const { impl } = stubFetch()

    const response = await handleFeedbackRequest(makeRequest(), makeEnv({ GITHUB_TOKEN: undefined }))

    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({ error: 'internal_error' })
    expect(text).not.toMatch(/GITHUB_TOKEN|TURNSTILE/)
    expect(impl).not.toHaveBeenCalled()
  })

  it('500s rather than throwing when something unexpected blows up', async () => {
    stubFetch()
    const env = makeEnv({
      FEEDBACK_RATE_LIMITER: {
        limit: async () => {
          throw new Error('binding exploded')
        },
      },
    })

    const response = await handleFeedbackRequest(makeRequest(), env)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'internal_error' })
  })
})
