import { describe, it, expect, vi } from 'vitest'
import { isWithinRateLimit } from './rateLimit.js'

describe('isWithinRateLimit', () => {
  it('passes the bucket key straight to the binding', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true })

    await isWithinRateLimit({ FEEDBACK_RATE_LIMITER: { limit } }, '203.0.113.7')

    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('allows a request the binding accepts and blocks one it rejects', async () => {
    const allowed = { FEEDBACK_RATE_LIMITER: { limit: async () => ({ success: true }) } }
    const blocked = { FEEDBACK_RATE_LIMITER: { limit: async () => ({ success: false }) } }

    await expect(isWithinRateLimit(allowed, 'ip')).resolves.toBe(true)
    await expect(isWithinRateLimit(blocked, 'ip')).resolves.toBe(false)
  })

  // Deliberate: losing the burst cap in a runtime without the binding is
  // acceptable, losing the whole form is not — Turnstile still gates everything.
  it('fails open when the binding is not configured', async () => {
    await expect(isWithinRateLimit({}, 'ip')).resolves.toBe(true)
    await expect(isWithinRateLimit({ FEEDBACK_RATE_LIMITER: {} }, 'ip')).resolves.toBe(true)
  })
})
