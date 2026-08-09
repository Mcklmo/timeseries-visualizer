import { describe, it, expect, vi } from 'vitest'
import { isWithinRateLimit } from './rateLimit.js'

describe('isWithinRateLimit', () => {
  it('passes the bucket key straight to the binding', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true })

    await isWithinRateLimit({ limit }, '203.0.113.7')

    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('allows a request the binding accepts and blocks one it rejects', async () => {
    const allowed = { limit: async () => ({ success: true }) }
    const blocked = { limit: async () => ({ success: false }) }

    await expect(isWithinRateLimit(allowed, 'ip')).resolves.toBe(true)
    await expect(isWithinRateLimit(blocked, 'ip')).resolves.toBe(false)
  })

  // Deliberate: losing the burst cap in a runtime without the binding is
  // acceptable, losing the whole feature is not — the feedback form still has
  // Turnstile in front of it, and the Strava routes still require a bearer
  // token Strava itself validates.
  it('fails open when the binding is not configured', async () => {
    await expect(isWithinRateLimit(undefined, 'ip')).resolves.toBe(true)
    await expect(isWithinRateLimit({}, 'ip')).resolves.toBe(true)
  })
})
