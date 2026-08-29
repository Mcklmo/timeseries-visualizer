// Route-level tests with the real chain (validate -> rate limit -> KV) and a
// Map-backed KV double — same philosophy as feedback.test.js: assert what the
// route produces, not which helpers it called.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SHARE_API_PATH,
  SHARE_LINK_PREFIX,
  handleShareLinkRequest,
  handleShareRequest,
  shareIdFor,
} from './share.js'

const validPayload = `1${'AbC-_9'.repeat(20)}`

function makeKv(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
  }
}

function makeEnv(overrides = {}) {
  return {
    SHARE_LINKS: makeKv(),
    SHARE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  }
}

function postRequest(body = { payload: validPayload }, init = {}) {
  return new Request(`https://example.com${SHARE_API_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...init.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
}

function getRequest(id, init = {}) {
  return new Request(`https://example.com${SHARE_LINK_PREFIX}${id}`, { method: 'GET', ...init })
}

// The route logs unhandled faults on purpose; keep test output clean.
let consoleError
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleError.mockRestore())

describe('POST /api/share', () => {
  it('stores the payload under its content-addressed id', async () => {
    const env = makeEnv()
    const response = await handleShareRequest(postRequest(), env)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{10}$/)
    expect(env.SHARE_LINKS.store.get(body.id)).toBe(validPayload)
  })

  it('is idempotent — the same payload always maps to the same id', async () => {
    const env = makeEnv()
    const first = await (await handleShareRequest(postRequest(), env)).json()
    const second = await (await handleShareRequest(postRequest(), env)).json()
    expect(second.id).toBe(first.id)
    expect(env.SHARE_LINKS.store.size).toBe(1)
    expect(first.id).toBe(await shareIdFor(validPayload))
  })

  it('rejects non-POST', async () => {
    const response = await handleShareRequest(
      new Request(`https://example.com${SHARE_API_PATH}`, { method: 'GET' }),
      makeEnv(),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('rejects unreadable JSON', async () => {
    const response = await handleShareRequest(postRequest('{not json'), makeEnv())
    expect(response.status).toBe(400)
  })

  it('rejects a declared-oversize body before reading it', async () => {
    const response = await handleShareRequest(
      postRequest({ payload: validPayload }, { headers: { 'content-length': String(50 * 1024) } }),
      makeEnv(),
    )
    expect(response.status).toBe(400)
  })

  it.each([
    ['a missing payload', {}],
    ['a non-string payload', { payload: 42 }],
    ['an empty payload', { payload: '' }],
    ['no leading version digit', { payload: 'xAbCdEf' }],
    ['characters outside base64url', { payload: '1AbC+dEf' }],
    ['a payload past the codec cap', { payload: `1${'A'.repeat(33000)}` }],
  ])('rejects %s with 422', async (_label, body) => {
    const env = makeEnv()
    const response = await handleShareRequest(postRequest(body), env)
    expect(response.status).toBe(422)
    expect(env.SHARE_LINKS.store.size).toBe(0)
  })

  it('answers 429 when the rate limiter says no, before touching KV', async () => {
    const env = makeEnv({ SHARE_RATE_LIMITER: { limit: async () => ({ success: false }) } })
    const response = await handleShareRequest(postRequest(), env)
    expect(response.status).toBe(429)
    expect(env.SHARE_LINKS.store.size).toBe(0)
  })

  it('answers 503 when the KV binding is not provisioned — the client falls back to the long URL', async () => {
    const response = await handleShareRequest(postRequest(), makeEnv({ SHARE_LINKS: undefined }))
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.error).toBe('shortener_unavailable')
  })
})

describe('GET /s/<id>', () => {
  it('redirects a stored id into the app with the payload in the hash', async () => {
    const id = await shareIdFor(validPayload)
    const env = makeEnv({ SHARE_LINKS: makeKv({ [id]: validPayload }) })

    const response = await handleShareLinkRequest(getRequest(id), env)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`/#a=${validPayload}`)
    // Content-addressed, so the redirect is cacheable.
    expect(response.headers.get('cache-control')).toContain('max-age')
  })

  it('redirects an unknown id to the in-app missing state, uncached', async () => {
    const response = await handleShareLinkRequest(getRequest('AbCdEfGh12'), makeEnv())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/#a=missing')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    ['a malformed id', 'not/valid!!'],
    ['a too-short id', 'AbC'],
    ['a too-long id', 'AbCdEfGh123456'],
  ])('treats %s as missing without touching KV', async (_label, id) => {
    const get = vi.fn()
    const response = await handleShareLinkRequest(getRequest(id), makeEnv({ SHARE_LINKS: { get } }))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/#a=missing')
    expect(get).not.toHaveBeenCalled()
  })

  it('treats a deployment without the binding as missing rather than erroring', async () => {
    const response = await handleShareLinkRequest(getRequest('AbCdEfGh12'), { SHARE_LINKS: undefined })
    expect(response.headers.get('location')).toBe('/#a=missing')
  })

  it('rejects non-GET', async () => {
    const response = await handleShareLinkRequest(getRequest('AbCdEfGh12', { method: 'DELETE' }), makeEnv())
    expect(response.status).toBe(405)
  })
})
