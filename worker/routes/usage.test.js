// Route-level tests with the real chain (rate limit -> body -> allowlist ->
// Analytics Engine), the same philosophy as share.test.js.
import { describe, expect, it } from 'vitest'
import { USAGE_API_PATH, USAGE_FEATURES } from '../../shared/usageEvents.js'
import { handleUsageRequest, parseUsageBody } from './usage.js'

function makeEnv(overrides = {}) {
  const points = []
  return {
    points,
    USAGE: { writeDataPoint: (point) => points.push(point) },
    USAGE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  }
}

function post(body, headers = {}) {
  return new Request(`https://activitymaxxer.com${USAGE_API_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/usage', () => {
  it('records each allowed feature and answers 204 with no body', async () => {
    const env = makeEnv()
    const response = await handleUsageRequest(post({ v: 1, f: ['load:file', 'zoom'] }, { 'sec-ch-ua-mobile': '?1' }), env)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(env.points.map((p) => p.blobs)).toEqual([
      ['feature', 'load:file', '', '', 'mobile'],
      ['feature', 'zoom', '', '', 'mobile'],
    ])
    expect(JSON.stringify(env.points)).not.toContain('203.0.113.7')
  })

  it('drops unknown and duplicate ids but keeps the rest', async () => {
    const env = makeEnv()
    await handleUsageRequest(post({ v: 1, f: ['zoom', 'zoom', 'filename:run.fit', 42] }), env)
    expect(env.points.map((p) => p.blobs[1])).toEqual(['zoom'])
  })

  it.each([
    ['not JSON', 'nope'],
    ['a wrong version', { v: 2, f: ['zoom'] }],
    ['no feature list', { v: 1 }],
    ['more ids than exist', { v: 1, f: [...USAGE_FEATURES, 'zoom'] }],
  ])('rejects %s with 400 and records nothing', async (_, body) => {
    const env = makeEnv()
    const response = await handleUsageRequest(post(body), env)
    expect(response.status).toBe(400)
    expect(env.points).toEqual([])
  })

  it('rejects an oversized body with 413', async () => {
    const env = makeEnv()
    const response = await handleUsageRequest(post({ v: 1, f: ['zoom'], pad: 'x'.repeat(4096) }), env)
    expect(response.status).toBe(413)
    expect(env.points).toEqual([])
  })

  it('rate limits by IP, and records nothing when limited', async () => {
    const env = makeEnv({ USAGE_RATE_LIMITER: { limit: async () => ({ success: false }) } })
    const response = await handleUsageRequest(post({ v: 1, f: ['zoom'] }), env)
    expect(response.status).toBe(429)
    expect(env.points).toEqual([])
  })

  it('answers 405 to anything but POST', async () => {
    const response = await handleUsageRequest(new Request(`https://activitymaxxer.com${USAGE_API_PATH}`), makeEnv())
    expect(response.status).toBe(405)
  })

  it('still answers 204 with no dataset bound (local dev)', async () => {
    const response = await handleUsageRequest(post({ v: 1, f: ['zoom'] }), makeEnv({ USAGE: undefined }))
    expect(response.status).toBe(204)
  })
})

describe('parseUsageBody', () => {
  it('returns null for non-objects', () => {
    expect(parseUsageBody(null)).toBeNull()
    expect(parseUsageBody('x')).toBeNull()
  })
})
