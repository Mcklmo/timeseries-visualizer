import { describe, it, expect, vi } from 'vitest'
import { verifyTurnstileToken } from './verifyTurnstile.js'

const siteverifyResponse = (body, init) => new Response(JSON.stringify(body), { status: 200, ...init })

describe('verifyTurnstileToken', () => {
  it('posts the secret, token and remote IP to Cloudflare siteverify', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(siteverifyResponse({ success: true }))

    await verifyTurnstileToken({
      token: 'token-abc',
      secret: 'secret-xyz',
      remoteIp: '203.0.113.7',
      fetchImpl,
    })

    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      secret: 'secret-xyz',
      response: 'token-abc',
      remoteip: '203.0.113.7',
    })
  })

  it('omits remoteip when the request carried no client IP', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(siteverifyResponse({ success: true }))

    await verifyTurnstileToken({ token: 't', secret: 's', fetchImpl })

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('remoteip')
  })

  it('resolves ok for a successful verification', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(siteverifyResponse({ success: true }))

    await expect(verifyTurnstileToken({ token: 't', secret: 's', fetchImpl })).resolves.toEqual({
      ok: true,
      errorCodes: [],
    })
  })

  it('surfaces Cloudflare error codes on a failed verification', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(siteverifyResponse({ success: false, 'error-codes': ['timeout-or-duplicate'] }))

    await expect(verifyTurnstileToken({ token: 't', secret: 's', fetchImpl })).resolves.toEqual({
      ok: false,
      errorCodes: ['timeout-or-duplicate'],
    })
  })

  // Fails closed on every infrastructure problem — an outage must never wave a
  // submission through.
  it('fails closed on a non-2xx siteverify response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))

    const result = await verifyTurnstileToken({ token: 't', secret: 's', fetchImpl })

    expect(result).toEqual({ ok: false, errorCodes: ['siteverify-http-error'] })
  })

  it('fails closed on a malformed siteverify body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }))

    const result = await verifyTurnstileToken({ token: 't', secret: 's', fetchImpl })

    expect(result).toEqual({ ok: false, errorCodes: ['siteverify-malformed-response'] })
  })

  it('fails closed (rather than throwing) when the network call rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))

    const result = await verifyTurnstileToken({ token: 't', secret: 's', fetchImpl })

    expect(result).toEqual({ ok: false, errorCodes: ['network-error'] })
  })
})
