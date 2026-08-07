import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCredentialStore } from '../data/intervals/credentialStore.js'
import { IntervalsPage } from './IntervalsPage.jsx'

const activities = [
  {
    id: 'i1',
    name: 'Tempo 5×1k',
    type: 'Run',
    start_date_local: '2026-08-11T17:04:00',
    icu_distance: 12400,
    moving_time: 3492,
    file_type: 'fit',
    source: 'GARMIN_CONNECT',
    device_name: 'Forerunner 965',
  },
  { id: 'i2', name: 'Sunday ride', type: 'Ride', start_date_local: '2026-08-09T09:00:00', source: 'STRAVA' },
]

function fakeStore(initialKey = null) {
  const map = new Map(initialKey ? [['k', initialKey]] : [])
  return {
    map,
    readApiKey: () => map.get('k') ?? null,
    saveApiKey: (key) => (map.set('k', key), true),
    clearApiKey: () => map.delete('k'),
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Routes by URL so one stub can serve both the profile check and the list. */
function stubApi({ profile = { id: 'i0' }, list = activities, status = {} } = {}) {
  return vi.fn(async (url) => {
    if (url.includes('/profile')) return jsonResponse(profile, status.profile ?? 200)
    if (url.includes('/activities')) return jsonResponse(list, status.list ?? 200)
    throw new Error(`unexpected request: ${url}`)
  })
}

function renderPage(props = {}) {
  return render(
    <IntervalsPage onBack={() => {}} onSelectActivity={() => {}} store={fakeStore()} {...props} />,
  )
}

describe('IntervalsPage — connecting', () => {
  it('shows the connect form when no key is stored, and nothing is requested', () => {
    const fetchImpl = stubApi()
    renderPage({ fetchImpl })

    expect(screen.getByLabelText(/intervals\.icu api key/i)).toHaveAttribute('type', 'password')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('points at Developer Settings in a new tab', () => {
    renderPage({ fetchImpl: stubApi() })

    const link = screen.getByRole('link', { name: /settings/i })
    expect(link).toHaveAttribute('href', 'https://intervals.icu/settings')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('states what the key can do and where it is kept', () => {
    renderPage({ fetchImpl: stubApi() })

    const notice = screen.getByText(/treat it as a password/i)
    expect(notice).toHaveTextContent(/full read and write access/i)
    expect(notice).toHaveTextContent(/kept in this browser's local storage until you disconnect/i)
    expect(notice).toHaveTextContent(/never pass through this app's server/i)
    expect(notice).toHaveTextContent(/regenerate it in Developer Settings/i)
  })

  // A key is only ever persisted once proven to work, so there is no
  // "connected but permanently broken" state to get stuck in.
  it('validates the key against the profile endpoint before storing it', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    const fetchImpl = stubApi()
    renderPage({ store, fetchImpl })

    await user.type(screen.getByLabelText(/intervals\.icu api key/i), 'good-key')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument())
    expect(store.readApiKey()).toBe('good-key')
    expect(fetchImpl.mock.calls[0][0]).toContain('/athlete/0/profile')
    // and the key is no longer sitting in a live DOM input
    expect(screen.queryByLabelText(/intervals\.icu api key/i)).not.toBeInTheDocument()
  })

  it('rejects a bad key inline and stores nothing', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    renderPage({ store, fetchImpl: stubApi({ status: { profile: 401 } }) })

    await user.type(screen.getByLabelText(/intervals\.icu api key/i), 'wrong-key')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/didn't accept that api key/i))
    expect(store.readApiKey()).toBeNull()
    expect(screen.getByLabelText(/intervals\.icu api key/i)).toBeInTheDocument()
  })

  it('does not request anything for an empty key', async () => {
    const user = userEvent.setup()
    const fetchImpl = stubApi()
    renderPage({ fetchImpl })

    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/paste your api key first/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('IntervalsPage — connected', () => {
  it('lists activities on mount when a key is already stored', async () => {
    const fetchImpl = stubApi()
    renderPage({ store: fakeStore('stored-key'), fetchImpl })

    await waitFor(() => expect(screen.getByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument())
    // oldest is always sent, newest never — see intervalsApi.js
    const listUrl = new URL(fetchImpl.mock.calls.find(([url]) => url.includes('/activities'))[0])
    expect(listUrl.searchParams.get('oldest')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(listUrl.searchParams.has('newest')).toBe(false)
  })

  it('dispatches an id ref carrying the real activity name when a row is picked', async () => {
    const user = userEvent.setup()
    const onSelectActivity = vi.fn()
    renderPage({ store: fakeStore('stored-key'), fetchImpl: stubApi(), onSelectActivity })

    await user.click(await screen.findByRole('button', { name: /Tempo 5×1k/ }))

    expect(onSelectActivity).toHaveBeenCalledWith({ type: 'id', id: 'i1', name: 'Tempo 5×1k' })
  })

  it('never dispatches for a Strava row — the guard is the disabled button itself', async () => {
    const user = userEvent.setup()
    const onSelectActivity = vi.fn()
    renderPage({ store: fakeStore('stored-key'), fetchImpl: stubApi(), onSelectActivity })

    const row = await screen.findByRole('button', { name: /Sunday ride/ })
    expect(row).toBeDisabled()
    await user.click(row)

    expect(onSelectActivity).not.toHaveBeenCalled()
  })

  it('credits Garmin when Garmin-sourced activities are on screen (API Terms §1.1)', async () => {
    renderPage({ store: fakeStore('stored-key'), fetchImpl: stubApi() })
    expect(await screen.findByText(/activity data from garmin/i)).toBeInTheDocument()
  })

  it('leaves the Garmin credit off when nothing on screen came from Garmin', async () => {
    const list = [{ id: 'i9', name: 'Manual entry', type: 'Run', start_date_local: '2026-08-11T17:04:00' }]
    renderPage({ store: fakeStore('stored-key'), fetchImpl: stubApi({ list }) })

    await screen.findByRole('button', { name: /Manual entry/ })
    expect(screen.queryByText(/activity data from garmin/i)).not.toBeInTheDocument()
  })

  it('widens the window backwards and merges without duplicating the overlap', async () => {
    const user = userEvent.setup()
    const older = { id: 'i3', name: 'Long run', type: 'Run', start_date_local: '2026-05-02T08:00:00' }
    // Second call re-returns the first window entirely — it must not double up.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(activities))
      .mockResolvedValueOnce(jsonResponse([...activities, older]))
    renderPage({ store: fakeStore('stored-key'), fetchImpl })

    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    await user.click(screen.getByRole('button', { name: /load earlier activities/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Long run/ })).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /Tempo 5×1k/ })).toHaveLength(1)

    // the cursor is anchored on the oldest activity held, so it reaches well
    // past the first window rather than repeating it
    const [firstOldest, secondOldest] = fetchImpl.mock.calls.map(
      ([url]) => new URL(url).searchParams.get('oldest'),
    )
    expect(secondOldest < firstOldest).toBe(true)
  })

  it('shows a banner and keeps the list on a non-auth failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(activities))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
    const user = userEvent.setup()
    renderPage({ store: fakeStore('stored-key'), fetchImpl })

    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    await user.click(screen.getByRole('button', { name: /load earlier activities/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many requests/i))
    expect(screen.getByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument()
  })

  // One 401 is terminal for that key — no retry loop, and the dead credential
  // is cleared rather than left to fail again on every later request.
  it('clears the stored key and returns to the connect form on a 401 mid-session', async () => {
    const store = fakeStore('revoked-key')
    renderPage({ store, fetchImpl: vi.fn(async () => new Response('', { status: 401 })) })

    await waitFor(() => expect(screen.getByLabelText(/intervals\.icu api key/i)).toBeInTheDocument())
    expect(store.readApiKey()).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/didn't accept that api key/i)
  })

  it('disconnects on demand, saying plainly that the key is not revoked upstream', async () => {
    const user = userEvent.setup()
    const store = fakeStore('stored-key')
    renderPage({ store, fetchImpl: stubApi() })

    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    expect(screen.getByText(/stays valid on intervals\.icu/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /disconnect/i }))

    expect(store.readApiKey()).toBeNull()
    expect(screen.getByLabelText(/intervals\.icu api key/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tempo 5×1k/ })).not.toBeInTheDocument()
  })

  it('calls onBack from the back button', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderPage({ onBack, fetchImpl: stubApi() })

    await user.click(screen.getByRole('button', { name: /^←\s*back$/i }))

    expect(onBack).toHaveBeenCalled()
  })
})
