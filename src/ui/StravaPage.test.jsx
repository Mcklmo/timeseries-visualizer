import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toApiDate } from '../data/activityDateRange.js'
import { StravaPage } from './StravaPage.jsx'

// The list filters to the last 90 days by default, so every fixture has to be
// expressed relative to now or this file starts failing on some future run
// date. Pinning the clock is the obvious alternative and is not available:
// fake timers hang RTL's `waitFor` under `globals: false`.
const dayAgo = (n) => {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return toApiDate(date)
}
/** Strava's own spelling: wall clock with a bogus trailing Z (see toActivityRow). */
const localDaysAgo = (n) => `${dayAgo(n)}T09:00:00Z`
const utcDaysAgo = (n) => `${dayAgo(n)}T07:00:00Z`

const activities = [
  {
    id: 9001,
    name: 'Tempo 5×1k',
    sport_type: 'TrailRun',
    start_date_local: localDaysAgo(1),
    start_date: utcDaysAgo(1),
    distance: 12400,
    moving_time: 3492,
    external_id: 'garmin_push_1234567890',
  },
  {
    id: 9002,
    name: 'Sunday ride',
    sport_type: 'Ride',
    start_date_local: localDaysAgo(3),
    start_date: utcDaysAgo(3),
    distance: 48000,
    moving_time: 5400,
  },
]

/** Never expires during a test run. */
const LIVE_TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + 6 * 3600_000,
  athleteId: 42,
}

function tokenStoreDouble(initial = null) {
  let held = initial
  return {
    read: () => held,
    save: (tokens) => ((held = tokens), true),
    clear: vi.fn(() => {
      held = null
    }),
  }
}

function cacheDouble(initial = null) {
  let held = initial
  return {
    read: () => held,
    save: vi.fn((rows) => ((held = rows), true)),
    clear: vi.fn(() => {
      held = null
    }),
  }
}

function streamCacheDouble() {
  return { get: () => undefined, set: () => {}, clear: vi.fn(), size: 0 }
}

function rangeStoreDouble() {
  let held = null
  return { read: () => held, save: (range) => (held = range) }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Routes by URL so one stub serves the list, the refresh and the revocation. */
function stubApi({ list = activities, status = {}, body = {} } = {}) {
  return vi.fn(async (url) => {
    if (url.includes('/api/strava/deauthorize')) return jsonResponse({ ok: true })
    if (url.includes('/api/strava/refresh')) {
      return jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: Date.now() + 3600_000 })
    }
    if (url.includes('/api/strava/activities')) {
      return jsonResponse(body.list ?? list, status.list ?? 200)
    }
    throw new Error(`unexpected request: ${url}`)
  })
}

/** One activity a day: `Day 1` yesterday, back to `Day n`. Enough of them to
 *  overflow a 50-row page, which is the only way the paging bug shows up. */
function activityPool(days) {
  return Array.from({ length: days }, (_, index) => {
    const n = index + 1
    return {
      id: 7000 + n,
      name: `Day ${n}`,
      sport_type: 'Run',
      start_date_local: localDaysAgo(n),
      start_date: utcDaysAgo(n),
      distance: 10000,
      moving_time: 3000,
    }
  })
}

/**
 * Honours `before`/`after` and the `per_page` cap, newest first — the shape the
 * real endpoint has, and the only one in which the paging bug is visible at
 * all. `stubApi` above returns its whole list whatever the window, so under it
 * a request that can never reach older activities looks exactly like one that
 * can; that is why the old paging test passed against broken paging.
 *
 * The window is applied to `start_date_local` read as wall clock, not to the
 * true UTC instant Strava would compare: the app's bounds are epoch seconds at
 * **local** midnight, so the two agree here whatever timezone the test machine
 * is in. Filtering on `start_date` would make this file's results depend on it.
 */
function windowedStubApi(pool, defaultPerPage = 50) {
  const startedAt = (activity) =>
    new Date(activity.start_date_local.replace(/Z$/, '')).getTime() / 1000
  return vi.fn(async (url) => {
    if (url.includes('/api/strava/deauthorize')) return jsonResponse({ ok: true })
    if (url.includes('/api/strava/refresh')) {
      return jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: Date.now() + 3600_000 })
    }
    if (url.includes('/api/strava/activities')) {
      const params = new URL(url, 'http://localhost').searchParams
      // `after` is strictly-after and `before` exclusive, per Strava's docs —
      // the semantics stravaBoundsFor's ±1-day/±1-second nudges are written
      // against.
      const after = params.has('after') ? Number(params.get('after')) : -Infinity
      const before = params.has('before') ? Number(params.get('before')) : Infinity
      const perPage = Number(params.get('per_page')) || defaultPerPage
      const inWindow = pool
        .filter((a) => startedAt(a) > after && startedAt(a) < before)
        .sort((a, b) => startedAt(b) - startedAt(a))
      return jsonResponse(inWindow.slice(0, perPage))
    }
    throw new Error(`unexpected request: ${url}`)
  })
}

/** Epoch seconds at local midnight — the unit the request bounds are sent in. */
function midnightOn(day) {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return Math.floor(new Date(year, month - 1, dayOfMonth).getTime() / 1000)
}

/** The `?before=`/`?after=` of each list request, in order. Refresh and
 *  deauthorize calls share the stub and are not requests for a window. */
function listWindows(fetchImpl) {
  return fetchImpl.mock.calls
    .filter(([url]) => url.includes('/api/strava/activities'))
    .map(([url]) => {
      const params = new URL(url, 'http://localhost').searchParams
      return { after: Number(params.get('after')), before: Number(params.get('before')) }
    })
}

/** The day numbers currently on screen, in render order. */
function visibleDays() {
  return screen
    .getAllByRole('button', { name: /^Day \d/ })
    .map((row) => Number(row.textContent.match(/^Day (\d+)/)[1]))
}

function renderPage(props = {}) {
  const seams = {
    store: tokenStoreDouble(),
    listCache: cacheDouble(),
    streamCache: streamCacheDouble(),
    rangeStore: rangeStoreDouble(),
    // The real button reads import.meta.env, which is a placeholder in this
    // repo until the Strava apps are registered — so the page suite injects a
    // configured id rather than asserting against an unconfigured build.
    connectButtonProps: { clientId: 'test-client-id', onNavigate: () => {} },
    ...props,
  }
  return {
    seams,
    ...render(<StravaPage onBack={() => {}} onSelectActivity={() => {}} {...seams} />),
  }
}

describe('StravaPage — the connect half', () => {
  it('shows the connect button when nothing is stored, and requests nothing', () => {
    const fetchImpl = stubApi()
    renderPage({ fetchImpl })

    expect(screen.getByRole('button', { name: /connect with strava/i })).toBeInTheDocument()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // The scope is the thing the athlete is actually agreeing to, and
  // activity:read_all includes private activities. Asking for it silently would
  // be the wrong trade even though the narrower scope fails more confusingly.
  it('discloses the scope, read-only, and what unticking it costs', () => {
    renderPage({ fetchImpl: stubApi() })

    // Queried by the paragraph's own opening words: the phrases below sit
    // partly inside a <strong>, so matching on one of them would return the
    // emphasis element rather than the sentence it belongs to.
    const disclosure = screen.getByText(/opens strava/i)
    expect(disclosure).toHaveTextContent(/read-only access to your activities/i)
    expect(disclosure).toHaveTextContent(/including private ones/i)
    expect(disclosure).toHaveTextContent(/never change or post anything/i)
    expect(disclosure).toHaveTextContent(/won't appear here/i)
  })

  // The honest cost, before connecting rather than on an About page the athlete
  // may never open — and the half where Strava's story is *better* said just as
  // plainly.
  it('says up front that this route goes through the app server, and what that means', () => {
    renderPage({ fetchImpl: stubApi() })

    const hint = screen.getByText(/goes through this app's server/i)
    expect(hint).toHaveTextContent(/stores nothing/i)
    expect(hint).toHaveTextContent(/expires every\s+six hours/i)
    expect(hint).toHaveTextContent(/can only ever read/i)
  })

  it('warns about the connected-account cap before the athlete tries', () => {
    renderPage({ fetchImpl: stubApi() })
    expect(screen.getByText(/limit on this app, not on\s+your account/i)).toBeInTheDocument()
  })

  // Required whenever a Strava connect control is shown (API Agreement).
  it('carries the Powered by Strava attribution', () => {
    renderPage({ fetchImpl: stubApi() })
    expect(screen.getByText(/powered by strava/i)).toBeInTheDocument()
  })

  // A cancelled sign-in, or a state that didn't check out, arrives from
  // useStravaOAuthCallback rather than from this page's own hook — and the
  // connect half is the only screen where saying so makes sense.
  it('renders a callback notice passed in from the OAuth return', () => {
    render(
      <StravaPage
        onBack={() => {}}
        onSelectActivity={() => {}}
        store={tokenStoreDouble()}
        listCache={cacheDouble()}
        streamCache={streamCacheDouble()}
        rangeStore={rangeStoreDouble()}
        fetchImpl={stubApi()}
        notice="Strava access was not granted."
        connectButtonProps={{ clientId: 'test-client-id', onNavigate: () => {} }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/not granted/i)
  })
})

describe('StravaPage — the connected half', () => {
  it('lists the athlete activities and asks for the default 90-day window', async () => {
    const fetchImpl = stubApi()
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl })

    await waitFor(() => expect(screen.getByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Sunday ride/ })).toBeInTheDocument()

    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('/api/strava/activities')
    // Epoch seconds, and `after` is nudged one second earlier than local
    // midnight so an activity starting exactly at 00:00:00 on the from-day is
    // not excluded by Strava's strictly-after semantics.
    const after = Number(new URL(url, 'http://localhost').searchParams.get('after'))
    expect(Number.isInteger(after)).toBe(true)
    expect(after).toBeLessThan(Math.floor(Date.now() / 1000))
  })

  // The bearer token goes in the header, never the query — the Worker forwards
  // exactly this header upstream and nothing else.
  it('sends the access token as a bearer header', async () => {
    const fetchImpl = stubApi()
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl })

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer access-1')
  })

  // The token is read at request time rather than held in React state, which is
  // what lets it be refreshed transparently. A six-hour access token *will*
  // expire under a picker that is left open, and the athlete must not have to
  // notice.
  it('refreshes an expired token before listing, and lists with the new one', async () => {
    const store = tokenStoreDouble({ ...LIVE_TOKENS, expiresAt: Date.now() - 1000 })
    const fetchImpl = stubApi()

    renderPage({ store, fetchImpl })

    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/strava/refresh')
    // The rotated refresh token replaces the old one — the response carries a
    // new one and kills the one that was sent, so failing to persist it means
    // reconnecting from scratch.
    expect(store.read()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' })
    expect(fetchImpl.mock.calls[1][1].headers.authorization).toBe('Bearer access-2')
  })

  // T2, from the UI side. `start_date_local` carries a bogus trailing Z on what
  // is really wall clock; leaving it on lands rows west of Greenwich on the
  // wrong calendar day, where the on-by-default filter then drops them.
  it('dates the row from wall clock, not from the bogus Z', async () => {
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl: stubApi() })

    const row = await screen.findByRole('button', { name: /Tempo 5×1k/ })
    const expected = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
      .format(new Date(`${dayAgo(1)}T09:00:00`))
      .replace(',', '')
    expect(within(row).getByText(new RegExp(expected))).toBeInTheDocument()
  })

  // **The whole reason the ref shape is what it is.** Three of these four fail
  // silently if omitted, and one of them (sportType) fails by charting every
  // run at half its real cadence without throwing.
  it('emits a ref carrying provider, id, startedAtUtc and sportType', async () => {
    const user = userEvent.setup()
    const onSelectActivity = vi.fn()
    render(
      <StravaPage
        onBack={() => {}}
        onSelectActivity={onSelectActivity}
        store={tokenStoreDouble(LIVE_TOKENS)}
        listCache={cacheDouble()}
        streamCache={streamCacheDouble()}
        rangeStore={rangeStoreDouble()}
        fetchImpl={stubApi()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: /Tempo 5×1k/ }))

    expect(onSelectActivity).toHaveBeenCalledWith({
      type: 'id',
      provider: 'strava',
      // A string, not the JSON number Strava sent (T6).
      id: '9001',
      name: 'Tempo 5×1k',
      startedAtUtc: utcDaysAgo(1),
      // The *humanized* label the row already carries — one value travels
      // instead of two that could disagree; sportFor accepts both spellings.
      sportType: 'Trail Run',
    })
  })

  // API Policy §4.4, and it tracks what is on screen rather than being
  // boilerplate: only this athlete's Garmin-synced rows earn the credit.
  it('credits Garmin only when a Garmin-derived row is in view', async () => {
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl: stubApi() })
    expect(await screen.findByText(/activity data from garmin, via strava/i)).toBeInTheDocument()
  })

  it('omits the Garmin credit when no row is Garmin-derived', async () => {
    const noGarmin = [{ ...activities[1] }]
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl: stubApi({ list: noGarmin }) })

    await screen.findByRole('button', { name: /Sunday ride/ })
    expect(screen.queryByText(/via strava/i)).not.toBeInTheDocument()
  })

  // Strava has no search endpoint. A disabled box, or one that filtered only
  // the loaded window, would both claim a capability that does not exist.
  it('renders no search box at all', async () => {
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl: stubApi() })

    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/search activities/i)).not.toBeInTheDocument()
  })

  // Unlike the intervals.icu list, the control is always offered: there is no
  // search mode on this provider, so there is never a set of hits with no
  // window under it to page.
  it('offers Load earlier activities as soon as the first window lands', async () => {
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl: stubApi() })

    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    expect(screen.getByRole('button', { name: /load earlier activities/i })).toBeInTheDocument()
  })
})

// **The regression suite for the ~50-row wall.** Every test here needs
// `windowedStubApi`: paging past the first page is invisible against a stub
// that returns its whole list however narrow the window, which is exactly why
// the old "widens the range backwards" test passed while the button was dead.
//
// One activity a day for 120 days, against a 90-day default range and a 50-row
// page: the first window can only return days 1-50, so days 51+ exist solely on
// the far side of a working *Load earlier activities*.
describe('StravaPage — paging past the first window', () => {
  const POOL_DAYS = 120

  async function renderPaged() {
    const user = userEvent.setup()
    const fetchImpl = windowedStubApi(activityPool(POOL_DAYS))
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl })
    await screen.findByRole('button', { name: /^Day 1\D/ })
    return { user, fetchImpl }
  }

  const loadEarlier = (user) =>
    user.click(screen.getByRole('button', { name: /load earlier activities/i }))

  // **The bug, stated directly.** `before` used to stay pinned to the range's
  // end, so a wider window ending on the same day re-fetched the same newest 50
  // activities, mergeById deduped every one of them away, and the list never
  // grew past its first page.
  it('reaches activities the first window could not return', async () => {
    const { user } = await renderPaged()

    expect(screen.queryByRole('button', { name: /^Day 60\D/ })).not.toBeInTheDocument()

    await loadEarlier(user)

    expect(await screen.findByRole('button', { name: /^Day 60\D/ })).toBeInTheDocument()
  })

  // The floor still has to widen too — a fetched row that falls outside the
  // range is filtered straight back out of the list by `activityInRange`.
  it('widens the range backwards *and* adds rows', async () => {
    const { user, fetchImpl } = await renderPaged()
    const before = visibleDays().length

    await loadEarlier(user)

    await waitFor(() => expect(visibleDays().length).toBeGreaterThan(before))
    const windows = listWindows(fetchImpl)
    expect(windows[1].after).toBeLessThan(windows[0].after)
  })

  // The ceiling lands on the whole of the oldest day held, not the day before
  // it: one day can hold several activities and only some of them may have
  // fitted in the last response. The overlapping day costs one duplicate that
  // mergeById drops; skipping it would silently lose rows.
  it('walks the request ceiling back to the oldest day held', async () => {
    const { user, fetchImpl } = await renderPaged()

    await loadEarlier(user)
    await waitFor(() => expect(listWindows(fetchImpl).length).toBe(2))

    const windows = listWindows(fetchImpl)
    // First request: the range's own end — today, sent exclusive as midnight
    // at the start of tomorrow, which is what `dayAgo(-1)` spells.
    expect(windows[0].before).toBe(midnightOn(dayAgo(-1)))
    // Second: the 50th day back is the oldest row held, so the ceiling is
    // midnight at the start of the day after it.
    expect(windows[1].before).toBe(midnightOn(dayAgo(49)))
  })

  // Rows arrive as a page strictly older than everything held, so the merged
  // order has to be stated rather than inherited from the response — otherwise
  // the second page renders above the first and the list reads oldest-first.
  it('keeps the list newest first across pages', async () => {
    const { user } = await renderPaged()

    await loadEarlier(user)
    await screen.findByRole('button', { name: /^Day 60\D/ })

    const days = visibleDays()
    expect(days).toEqual([...days].sort((a, b) => a - b))
    expect(days[0]).toBe(1)
  })

  // A new filter is a new browse. Without the reset, tapping *30 days*
  // mid-paging would ask for the last 30 days *ending months ago* — a window
  // with nothing in it.
  it('drops the ceiling back to the range end when the filter changes', async () => {
    const { user, fetchImpl } = await renderPaged()
    await loadEarlier(user)
    await screen.findByRole('button', { name: /^Day 60\D/ })

    await user.click(screen.getByRole('button', { name: /30 days/ }))

    await waitFor(() => expect(listWindows(fetchImpl).length).toBe(3))
    const windows = listWindows(fetchImpl)
    expect(windows[2].before).toBe(midnightOn(dayAgo(-1)))
    // `after` is nudged one second earlier than local midnight, per
    // stravaBoundsFor — Strava reads it as strictly-after.
    expect(windows[2].after).toBe(midnightOn(dayAgo(30)) - 1)
    // And the list narrows to what the athlete asked for, keeping the rows it
    // already fetched behind the filter rather than dropping them.
    expect(screen.queryByRole('button', { name: /^Day 60\D/ })).not.toBeInTheDocument()
  })
})

describe('StravaPage — the list cache', () => {
  // The cache exists to remove the blank screen, not to be the last word: the
  // request still fires behind the seeded rows.
  it('paints cached rows on first render and refreshes behind them', async () => {
    const cached = [
      {
        id: '8000',
        name: 'From the cache',
        startedAt: `${dayAgo(2)}T09:00:00`,
        startedAtUtc: utcDaysAgo(2),
        distanceM: 5000,
        durationS: 1500,
        sportLabel: 'Run',
        unsupportedReason: null,
        isGarminDerived: false,
      },
    ]
    const fetchImpl = stubApi()
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), listCache: cacheDouble(cached), fetchImpl })

    // Present synchronously — no waitFor, which is the whole point.
    expect(screen.getByRole('button', { name: /From the cache/ })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument())
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('writes what is on screen back to the cache after a response', async () => {
    const listCache = cacheDouble()
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), listCache, fetchImpl: stubApi() })

    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    await waitFor(() => expect(listCache.save).toHaveBeenCalled())
    expect(listCache.save.mock.calls.at(-1)[0].map((row) => row.id)).toEqual(['9001', '9002'])
  })
})

describe('StravaPage — disconnecting', () => {
  // **The §7.4 obligation, and the ordering is the test.** Both caches first,
  // then the revocation — which needs a live token, so clearing the store
  // before it would make the call impossible while looking like it worked.
  it('clears both caches, deauthorizes, and only then clears the tokens', async () => {
    const user = userEvent.setup()
    const store = tokenStoreDouble(LIVE_TOKENS)
    const listCache = cacheDouble()
    const streamCache = streamCacheDouble()
    const order = []
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.includes('/api/strava/deauthorize')) {
        order.push('deauthorize')
        // The revocation must carry the token that is being revoked.
        expect(init.headers.authorization).toBe('Bearer access-1')
        return jsonResponse({ ok: true })
      }
      if (url.includes('/api/strava/activities')) return jsonResponse(activities)
      throw new Error(`unexpected request: ${url}`)
    })
    listCache.clear.mockImplementation(() => order.push('listCache'))
    streamCache.clear.mockImplementation(() => order.push('streamCache'))
    store.clear.mockImplementation(() => order.push('tokens'))

    renderPage({ store, listCache, streamCache, fetchImpl })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })

    await user.click(screen.getByRole('button', { name: /disconnect/i }))

    await waitFor(() => expect(order).toContain('tokens'))
    expect(order).toEqual(['listCache', 'streamCache', 'deauthorize', 'tokens'])
  })

  it('drops back to the connect half immediately, without waiting on the network', async () => {
    const user = userEvent.setup()
    // A revocation that never settles: the UI must not be waiting on it.
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/api/strava/deauthorize')) return new Promise(() => {})
      return jsonResponse(activities)
    })
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })

    await user.click(screen.getByRole('button', { name: /disconnect/i }))

    expect(screen.getByRole('button', { name: /connect with strava/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tempo 5×1k/ })).not.toBeInTheDocument()
  })

  // A failed revocation must still leave the app disconnected locally. There is
  // nothing useful to say and nothing the athlete can do about it here — and
  // the grant stays revocable from Strava's own settings, which the copy links.
  it('still clears the tokens when the revocation fails', async () => {
    const user = userEvent.setup()
    const store = tokenStoreDouble(LIVE_TOKENS)
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/api/strava/deauthorize')) throw new TypeError('network down')
      return jsonResponse(activities)
    })
    renderPage({ store, fetchImpl })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })

    await user.click(screen.getByRole('button', { name: /disconnect/i }))

    await waitFor(() => expect(store.clear).toHaveBeenCalled())
    expect(store.read()).toBeNull()
  })

  it('links Strava own app settings, where the grant can be checked or undone', async () => {
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl: stubApi() })

    const link = await screen.findByRole('link', { name: /my apps/i })
    expect(link).toHaveAttribute('href', 'https://www.strava.com/settings/apps')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})

describe('StravaPage — failures', () => {
  // Terminal: the grant is gone, and no retry helps. The tokens and both caches
  // go with it, and the athlete lands back on the connect half being told why.
  it('drops back to connect and clears everything on a 401', async () => {
    const store = tokenStoreDouble(LIVE_TOKENS)
    const listCache = cacheDouble()
    const streamCache = streamCacheDouble()
    const fetchImpl = stubApi({ status: { list: 401 } })

    renderPage({ store, listCache, streamCache, fetchImpl })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /connect with strava/i })).toBeInTheDocument(),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/connect again/i)
    expect(store.clear).toHaveBeenCalled()
    expect(listCache.clear).toHaveBeenCalled()
    expect(streamCache.clear).toHaveBeenCalled()
  })

  // Also terminal, but it must NOT read as a rejected login: the athlete did
  // nothing wrong and reconnecting cannot help.
  it('names the athlete cap as a limit on the app, not on the account', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, error: 'athlete_cap' }, 403))
    renderPage({ store: tokenStoreDouble(LIVE_TOKENS), fetchImpl })

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/limited number of Strava accounts/i),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/limit on the app, not on your account/i)
  })

  // Not terminal: a banner the athlete can retry past, with the connection and
  // the rows left alone.
  it('keeps the connection on a rate limit, and names when it resets', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Rate Limit Exceeded' }, 429))
    const store = tokenStoreDouble(LIVE_TOKENS)
    renderPage({ store, fetchImpl })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/rate limit/i))
    expect(screen.getByRole('alert')).toHaveTextContent(/quarter hour/i)
    expect(store.clear).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument()
    // Never retried automatically — unlike a transient failure, a 429 answered
    // again immediately is the same 429.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
