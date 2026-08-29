import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/providers.jsx'
import { SHARE_HASH_PREFIX, decodePayload } from '../data/shared/shareCodec.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { ShareActivityButton } from './ShareActivityButton.jsx'

const fixtureActivity = {
  id: 'a1',
  sport: 'running',
  name: 'Morning Run',
  startTime: new Date('2026-08-01T07:00:00Z'),
  totalTime: 40,
  totalMovingTime: 40,
  totalDistance: 200,
  samplingIntervalS: 10,
  samples: Array.from({ length: 5 }, (_, i) => ({
    t: i * 10,
    d: i * 50,
    heartRate: 120 + i * 10,
    moving: true,
  })),
  availableMetrics: ['heartRate'],
  track: null,
}

function Loader() {
  const { load } = useActivity()
  useEffect(() => {
    load({ type: 'id', provider: 'intervals', id: 'x' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

async function renderButton({ activity = fixtureActivity } = {}) {
  const utils = render(
    <AppProviders source={{ kind: 'mock', load: () => Promise.resolve(activity) }}>
      <Loader />
      <ShareActivityButton />
    </AppProviders>,
  )
  await screen.findByRole('button', { name: 'Share' })
  return utils
}

// jsdom ships neither navigator.share nor navigator.clipboard, so each test
// installs exactly the surface it needs — same per-test defineProperty idiom
// setupTests.js uses for matchMedia.
function defineNavigator(key, value) {
  Object.defineProperty(navigator, key, { value, configurable: true })
}

/** POST /api/share double for the default `fetch` path in shareClient. */
function stubShareApi(result) {
  const fetchMock = vi.fn().mockImplementation(result)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const shortLinkResponse = () =>
  Promise.resolve(new Response(JSON.stringify({ ok: true, id: 'AbCdEf1234' }), { status: 201 }))

afterEach(() => {
  delete navigator.share
  delete navigator.clipboard
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ShareActivityButton', () => {
  it('renders nothing before an activity is loaded', () => {
    render(
      <AppProviders source={{ kind: 'mock', load: () => Promise.resolve(fixtureActivity) }}>
        <ShareActivityButton />
      </AppProviders>,
    )
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
  })

  it('prefers the short link and hands it to the native share sheet', async () => {
    const fetchMock = stubShareApi(shortLinkResponse)
    const share = vi.fn().mockResolvedValue(undefined)
    defineNavigator('share', share)

    await renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(share).toHaveBeenCalledWith({ url: `${location.origin}/s/AbCdEf1234` })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/share',
      expect.objectContaining({ method: 'POST' }),
    )
    // The payload the server was handed is a real, decodable share payload.
    const { payload } = JSON.parse(fetchMock.mock.calls[0][1].body)
    const decoded = await decodePayload(payload)
    expect(decoded.name).toBe('Morning Run')
    expect(decoded.trackpoints).toHaveLength(5)
  })

  it('falls back to the self-contained hash URL when the shorten POST fails', async () => {
    stubShareApi(() => Promise.reject(new TypeError('offline')))
    const share = vi.fn().mockResolvedValue(undefined)
    defineNavigator('share', share)

    await renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const url = share.mock.calls[0][0].url
    expect(url.startsWith(`${location.origin}/${SHARE_HASH_PREFIX}`)).toBe(true)
    // The fallback URL is the whole activity: decode what was shared.
    const decoded = await decodePayload(url.split(SHARE_HASH_PREFIX)[1])
    expect(decoded.trackpoints).toHaveLength(5)
    // Silent degradation — no error for a step the user never asked for.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats a cancelled share sheet as a choice, not an error', async () => {
    stubShareApi(shortLinkResponse)
    const abort = new Error('cancelled')
    abort.name = 'AbortError'
    defineNavigator('share', vi.fn().mockRejectedValue(abort))
    const writeText = vi.fn()
    defineNavigator('clipboard', { writeText })

    await renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled())
    expect(screen.queryByRole('alert')).toBeNull()
    // And no consolation copy either — cancelling is not a failure to route around.
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies to the clipboard where there is no share sheet, and says so transiently', async () => {
    stubShareApi(shortLinkResponse)
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineNavigator('clipboard', { writeText })

    await renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    await screen.findByRole('button', { name: 'Copied' })
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/AbCdEf1234`)
    // The label returns to Share once the moment passes.
    await screen.findByRole('button', { name: 'Share' }, { timeout: 3000 })
  })

  it('falls through to the clipboard when the share sheet refuses for any other reason', async () => {
    stubShareApi(shortLinkResponse)
    const refused = new Error('transient activation expired')
    refused.name = 'NotAllowedError'
    defineNavigator('share', vi.fn().mockRejectedValue(refused))
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineNavigator('clipboard', { writeText })

    await renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    await screen.findByRole('button', { name: 'Copied' })
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('shows an inline error when no delivery path exists at all', async () => {
    stubShareApi(shortLinkResponse)

    await renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/not available/i)
    // The activity is untouched — only the button row reports it.
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()
  })
})
