import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { STRAVA_STATE_STORAGE_KEY } from '../data/strava/stravaAuth.js'
import { CALLBACK_MESSAGES, useStravaOAuthCallback } from './useStravaOAuthCallback.js'

// jsdom cannot navigate, so the callback URL is installed with history.pushState
// — which is real navigation as far as location.search is concerned, and lets
// the hook's own history.replaceState be observed rather than stubbed.
function landOn(query) {
  globalThis.history.pushState(null, '', `/${query}`)
}

function tokenStoreDouble() {
  const saved = []
  return { saved, save: (tokens) => saved.push(tokens), read: () => saved.at(-1) ?? null, clear: () => {} }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_760_000_000_000,
  athlete: { id: 42 },
}

/** Renders the hook and surfaces its return value as text to assert on. */
function Probe(props) {
  const { status, message } = useStravaOAuthCallback(props)
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="message">{message ?? ''}</span>
    </div>
  )
}

beforeEach(() => {
  globalThis.sessionStorage.clear()
})

afterEach(() => {
  globalThis.history.replaceState(null, '', '/')
})

describe('useStravaOAuthCallback — the ordinary page load', () => {
  // The overwhelmingly common case, and the one that must cost nothing: a
  // visitor who never touches Strava.
  it('does nothing at all when there is no callback in the query', () => {
    landOn('')
    const fetchImpl = vi.fn()
    const store = tokenStoreDouble()
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')

    render(<Probe store={store} fetchImpl={fetchImpl} />)

    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.saved).toHaveLength(0)
    // Notably it does NOT consume the stored state: an unrelated page load must
    // not spend a state a real callback is still going to need.
    expect(globalThis.sessionStorage.getItem(STRAVA_STATE_STORAGE_KEY)).toBe('state-1')
  })
})

describe('useStravaOAuthCallback — a successful return', () => {
  it('exchanges the code, stores the tokens with the athlete id, and reports connected', async () => {
    landOn('?code=abc123&state=state-1&scope=read,activity:read_all')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')
    const store = tokenStoreDouble()
    const fetchImpl = vi.fn(async () => jsonResponse(TOKENS))

    render(<Probe store={store} fetchImpl={fetchImpl} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/strava/token')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ code: 'abc123' })
    expect(store.saved).toEqual([
      {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 1_760_000_000_000,
        athleteId: 42,
      },
    ])
  })

  // Guard 2. A reload, a remount or the back button must find no `code` left to
  // re-exchange — and the code is single-use, so a second attempt 400s.
  it('strips the query before awaiting anything', async () => {
    landOn('?code=abc123&state=state-1&scope=activity:read_all')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')
    let searchDuringExchange = 'not observed'
    const fetchImpl = vi.fn(async () => {
      searchDuringExchange = globalThis.location.search
      return jsonResponse(TOKENS)
    })

    render(<Probe store={tokenStoreDouble()} fetchImpl={fetchImpl} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    // Already gone by the time the request went out, not merely gone afterwards.
    expect(searchDuringExchange).toBe('')
    expect(globalThis.location.search).toBe('')
    expect(globalThis.location.pathname).toBe('/')
  })

  // T4, and the reason both guards exist. main.jsx wraps the tree in
  // <StrictMode>, which invokes every effect twice in development; the code is
  // single-use, so the second exchange fails with a confusing 400 — in dev
  // only, on a path that works in production.
  it('exchanges exactly once under StrictMode double-invoke', async () => {
    landOn('?code=abc123&state=state-1&scope=activity:read_all')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')
    const store = tokenStoreDouble()
    const fetchImpl = vi.fn(async () => jsonResponse(TOKENS))

    render(
      <StrictMode>
        <Probe store={store} fetchImpl={fetchImpl} />
      </StrictMode>,
    )

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.saved).toHaveLength(1)
  })
})

describe('useStravaOAuthCallback — refusals', () => {
  // The athlete pressed Cancel. A user choice, not an error state, and it gets
  // its own copy rather than a generic failure.
  it('reports access_denied in its own words, without exchanging', async () => {
    landOn('?error=access_denied&state=state-1')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')
    const fetchImpl = vi.fn()

    render(<Probe store={tokenStoreDouble()} fetchImpl={fetchImpl} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('refused'))
    expect(screen.getByTestId('message')).toHaveTextContent(CALLBACK_MESSAGES.denied)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // The exchange is the irreversible step, so the CSRF check comes first — not
  // alongside, and certainly not after.
  it('refuses a mismatched state WITHOUT exchanging', async () => {
    landOn('?code=abc123&state=attacker&scope=activity:read_all')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')
    const fetchImpl = vi.fn()
    const store = tokenStoreDouble()

    render(<Probe store={store} fetchImpl={fetchImpl} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('refused'))
    expect(screen.getByTestId('message')).toHaveTextContent(CALLBACK_MESSAGES.state)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.saved).toHaveLength(0)
  })

  // A callback that lands in a different tab has no state to check against —
  // sessionStorage is tab-scoped, which is exactly why the state lives there.
  it('refuses when no state was stored at all', async () => {
    landOn('?code=abc123&state=state-1&scope=activity:read_all')
    const fetchImpl = vi.fn()

    render(<Probe store={tokenStoreDouble()} fetchImpl={fetchImpl} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('refused'))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // Read-and-delete: a state that has been checked once is spent, so a replayed
  // callback URL cannot be accepted a second time.
  it('consumes the stored state whether or not it matched', async () => {
    landOn('?code=abc123&state=attacker&scope=activity:read_all')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')

    render(<Probe store={tokenStoreDouble()} fetchImpl={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('refused'))
    expect(globalThis.sessionStorage.getItem(STRAVA_STATE_STORAGE_KEY)).toBeNull()
  })

  // Strava lets the athlete untick "View data about your private activities" on
  // the consent screen. Caught here rather than discovered later as a
  // mysteriously short list.
  it('refuses when activity:read_all was not granted, and says which permission', async () => {
    landOn('?code=abc123&state=state-1&scope=read')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')
    const fetchImpl = vi.fn()

    render(<Probe store={tokenStoreDouble()} fetchImpl={fetchImpl} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('refused'))
    expect(screen.getByTestId('message')).toHaveTextContent(CALLBACK_MESSAGES.scope)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // A coded StravaApiError already carries copy written for this athlete, so it
  // is surfaced verbatim rather than replaced by a generic message.
  it('surfaces the exchange failure message from the API error', async () => {
    landOn('?code=abc123&state=state-1&scope=activity:read_all')
    globalThis.sessionStorage.setItem(STRAVA_STATE_STORAGE_KEY, 'state-1')
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, error: 'athlete_cap' }, 403),
    )

    render(<Probe store={tokenStoreDouble()} fetchImpl={fetchImpl} />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('refused'))
    expect(screen.getByTestId('message')).toHaveTextContent(/limited number of Strava accounts/i)
    // Still stripped, even on the failing path: the code is spent either way.
    expect(globalThis.location.search).toBe('')
  })
})
