import { describe, expect, it, vi } from 'vitest'
import { SHARE_ENDPOINT, createShortShareLink } from './shareClient.js'

describe('createShortShareLink', () => {
  it('returns the id on the contract response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, id: 'AbCdEfGh12' }), { status: 201 }),
    )
    const result = await createShortShareLink('1AbC', fetchImpl)
    expect(result).toEqual({ ok: true, id: 'AbCdEfGh12' })
    expect(fetchImpl).toHaveBeenCalledWith(SHARE_ENDPOINT, expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ payload: '1AbC' })
  })

  it.each([
    ['a thrown fetch', async () => Promise.reject(new TypeError('offline'))],
    ['an HTML answer from a proxy', async () => new Response('<html>oops</html>', { status: 200 })],
    ['a 503 from an unprovisioned deployment', async () => new Response(JSON.stringify({ ok: false, error: 'shortener_unavailable' }), { status: 503 })],
    ['a success without an id', async () => new Response(JSON.stringify({ ok: true }), { status: 201 })],
  ])('degrades %s to a silent {ok: false}', async (_label, impl) => {
    await expect(createShortShareLink('1AbC', vi.fn(impl))).resolves.toEqual({ ok: false })
  })
})
