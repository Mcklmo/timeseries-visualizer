import { describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultRange, formatRangeLabel, toApiDate } from '../data/activityDateRange.js'
import { DATE_RANGE_STORAGE_KEY } from '../data/intervals/dateRangeStore.js'
import { IntervalsPage } from './IntervalsPage.jsx'

// The list filters to the last 90 days by default, so every fixture — and
// every range these tests type into the fields — has to be expressed relative
// to now, or the whole file starts failing on some future run date. Pinning
// the clock is the obvious alternative and is not available here: fake timers
// hang RTL's `waitFor` under `globals: false` (see the searching block).
const dayAgo = (n) => {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return toApiDate(date)
}
const daysAgo = (n) => `${dayAgo(n)}T09:00:00`

const activities = [
  {
    id: 'i1',
    name: 'Tempo 5×1k',
    type: 'Run',
    start_date_local: daysAgo(1),
    icu_distance: 12400,
    moving_time: 3492,
    file_type: 'fit',
    source: 'GARMIN_CONNECT',
    device_name: 'Forerunner 965',
  },
  { id: 'i2', name: 'Sunday ride', type: 'Ride', start_date_local: daysAgo(3), source: 'STRAVA' },
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

/** Routes by URL so one stub can serve the profile check, the list and search. */
function stubApi({ profile = { id: 'i0' }, list = activities, hits = [], status = {} } = {}) {
  return vi.fn(async (url) => {
    if (url.includes('/profile')) return jsonResponse(profile, status.profile ?? 200)
    // Before the /activities branch, deliberately: the search path is
    // /activities/search-full, so it matches both, and the wrong order serves
    // the browse fixture to every search test — which passes, for the wrong
    // reason.
    if (url.includes('/search-full')) return jsonResponse(hits, status.search ?? 200)
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
    // Both bounds are sent now that the filter is on by default — the date
    // range block pins which days they are.
    const listUrl = new URL(fetchImpl.mock.calls.find(([url]) => url.includes('/activities'))[0])
    expect(listUrl.searchParams.get('oldest')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(listUrl.searchParams.get('newest')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('dispatches an id ref carrying the real activity name when a row is picked', async () => {
    const user = userEvent.setup()
    const onSelectActivity = vi.fn()
    renderPage({ store: fakeStore('stored-key'), fetchImpl: stubApi(), onSelectActivity })

    await user.click(await screen.findByRole('button', { name: /Tempo 5×1k/ }))

    expect(onSelectActivity).toHaveBeenCalledWith({
      type: 'id',
      provider: 'intervals',
      id: 'i1',
      name: 'Tempo 5×1k',
    })
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
    const list = [{ id: 'i9', name: 'Manual entry', type: 'Run', start_date_local: daysAgo(1) }]
    renderPage({ store: fakeStore('stored-key'), fetchImpl: stubApi({ list }) })

    await screen.findByRole('button', { name: /Manual entry/ })
    expect(screen.queryByText(/activity data from garmin/i)).not.toBeInTheDocument()
  })

  it('widens the window backwards and merges without duplicating the overlap', async () => {
    const user = userEvent.setup()
    // Outside the default 90-day floor, inside the widened one: paging is now
    // a 90-day step back from the oldest row held (3 days ago), i.e. 93.
    const older = { id: 'i3', name: 'Long run', type: 'Run', start_date_local: daysAgo(91) }
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

// Real timers throughout, and the real 300 ms debounce with them: RTL's
// waitFor cannot drive Vitest's fake clock under `globals: false` (its
// fake-timer support checks for a `jest` global, which does not exist here),
// so faking time would hang waitFor rather than speed anything up. The timing
// itself is proven at unit level in useDebouncedValue.test.js; these tests
// only wait it out. `delay: null` keeps a typed burst synchronous, so it can't
// straddle the debounce window on a slow machine.
describe('IntervalsPage — searching', () => {
  const SETTLE_MS = 450

  const typist = () => userEvent.setup({ delay: null })
  const searchBox = () => screen.getByLabelText(/search activities/i)
  const settleDebounce = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const searchCalls = (fetchImpl) => fetchImpl.mock.calls.filter(([url]) => url.includes('/search-full'))

  // Not in the browse fixture at all, which is what makes these tests about
  // searching the whole history. Its *date* still has to sit inside the
  // default range: hits go through the same client-side predicate the browse
  // list does, and a range that empties them has its own test further down.
  const hillRepeats = {
    id: 'i7',
    name: 'Hill repeats',
    type: 'Run',
    start_date_local: daysAgo(45),
    icu_distance: 8000,
    moving_time: 2400,
    file_type: 'fit',
  }

  /** Renders with a stored key and waits for the browse list to be on screen. */
  async function renderConnected(props = {}) {
    const fetchImpl = props.fetchImpl ?? stubApi()
    renderPage({ store: fakeStore('stored-key'), ...props, fetchImpl })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    return fetchImpl
  }

  // The whole point of the feature: /search-full covers the entire history,
  // where the browse list only ever holds a rolling window.
  it('searches the full history once per typing burst and renders the hits', async () => {
    const user = typist()
    const fetchImpl = await renderConnected({ fetchImpl: stubApi({ hits: [hillRepeats] }) })

    await user.type(searchBox(), 'hill')

    expect(await screen.findByRole('button', { name: /Hill repeats/ })).toBeInTheDocument()
    expect(searchCalls(fetchImpl)).toHaveLength(1)
    const url = new URL(searchCalls(fetchImpl)[0][0])
    expect(url.pathname).toBe('/api/v1/athlete/0/activities/search-full')
    expect(url.searchParams.get('q')).toBe('hill')
    // the browse list is replaced, not appended to
    expect(screen.queryByRole('button', { name: /Tempo 5×1k/ })).not.toBeInTheDocument()
  })

  // A single character matches most of a history for a full-fat response.
  it('stays inert below the two-character minimum', async () => {
    const user = typist()
    const fetchImpl = await renderConnected()

    await user.type(searchBox(), 'h')
    await settleDebounce()

    expect(searchCalls(fetchImpl)).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument()
  })

  it('passes a #tag query through verbatim — the API does the tag matching', async () => {
    const user = typist()
    const fetchImpl = await renderConnected({ fetchImpl: stubApi({ hits: [hillRepeats] }) })

    await user.type(searchBox(), '#threshold')

    await screen.findByRole('button', { name: /Hill repeats/ })
    expect(new URL(searchCalls(fetchImpl)[0][0]).searchParams.get('q')).toBe('#threshold')
  })

  // The browse effect keys on the request bounds, which searching never
  // touches, so it never re-fired — the window is simply still there
  // underneath, with no second list request.
  it('restores the browse list when the box is cleared, without refetching it', async () => {
    const user = typist()
    const fetchImpl = await renderConnected({ fetchImpl: stubApi({ hits: [hillRepeats] }) })
    await user.type(searchBox(), 'hill')
    await screen.findByRole('button', { name: /Hill repeats/ })
    const listCalls = fetchImpl.mock.calls.length

    await user.click(screen.getByRole('button', { name: /clear search/i }))

    expect(await screen.findByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hill repeats/ })).not.toBeInTheDocument()
    await settleDebounce()
    expect(fetchImpl.mock.calls.length).toBe(listCalls)
  })

  // Debounced typing means two searches can be in flight at once, and the
  // slower one can be the older one. The `cancelled` guard is what stops it
  // landing on top of the newer query's rows.
  it('ignores an earlier search that resolves after a later one', async () => {
    const user = typist()
    const pending = []
    const fetchImpl = vi.fn(async (url) => {
      if (!url.includes('/search-full')) return jsonResponse(activities)
      const query = new URL(url).searchParams.get('q')
      return new Promise((resolve) => pending.push({ query, resolve }))
    })
    renderPage({ store: fakeStore('stored-key'), fetchImpl })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })

    await user.type(searchBox(), 'hi')
    await waitFor(() => expect(pending).toHaveLength(1))
    await user.type(searchBox(), 'll')
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(pending.map((p) => p.query)).toEqual(['hi', 'hill'])

    // newest answer first, then the stale one it must not be overwritten by
    pending[1].resolve(jsonResponse([hillRepeats]))
    await screen.findByRole('button', { name: /Hill repeats/ })
    // dated inside the default range on purpose: the *only* reason this row
    // must not appear is the `cancelled` guard, not the date predicate
    pending[0].resolve(
      jsonResponse([{ id: 'i8', name: 'Hilly commute', type: 'Ride', start_date_local: daysAgo(5) }]),
    )
    await settleDebounce()

    expect(screen.getByRole('button', { name: /Hill repeats/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hilly commute/ })).not.toBeInTheDocument()
  })

  // The default range is a real range, so the empty message names it — which
  // is honest about *why* nothing matched, where "the last few months" would
  // not be.
  it('says nothing matched, naming the range rather than claiming the window was empty', async () => {
    const user = typist()
    await renderConnected({ fetchImpl: stubApi({ hits: [] }) })

    await user.type(searchBox(), 'kayak')

    const label = formatRangeLabel(defaultRange())
    expect(await screen.findByText(`No activities match "kayak" ${label}.`)).toBeInTheDocument()
    expect(screen.queryByText(/last few months/i)).not.toBeInTheDocument()
  })

  it('offers no "load earlier" in search mode — there is no window under the hits', async () => {
    const user = typist()
    await renderConnected({ fetchImpl: stubApi({ hits: [hillRepeats] }) })
    expect(screen.getByRole('button', { name: /load earlier activities/i })).toBeInTheDocument()

    await user.type(searchBox(), 'hill')
    await screen.findByRole('button', { name: /Hill repeats/ })

    expect(screen.queryByRole('button', { name: /load earlier activities/i })).not.toBeInTheDocument()
  })

  // The pre-flight guard is why /search-full is worth its weight: the light
  // /search rows carry no `source`, so this row would have looked pickable.
  it('greys out a Strava hit with its reason, exactly as in the browse list', async () => {
    const user = typist()
    const strava = { id: 'i9', name: 'Strava import', type: 'Ride', source: 'STRAVA', start_date_local: daysAgo(2) }
    await renderConnected({ fetchImpl: stubApi({ hits: [strava] }) })

    await user.type(searchBox(), 'strava')

    const row = await screen.findByRole('button', { name: /Strava import/ })
    expect(row).toBeDisabled()
    expect(row).toHaveTextContent(/intervals\.icu doesn't keep the original file/i)
  })

  // API Terms §1.1 is about what is on screen, so the credit has to follow the
  // hits — the browse window behind them is irrelevant while they are showing.
  it('tracks the Garmin credit to the rows actually displayed', async () => {
    const user = typist()
    await renderConnected({ fetchImpl: stubApi({ hits: [hillRepeats] }) })
    expect(screen.getByText(/activity data from garmin/i)).toBeInTheDocument()

    await user.type(searchBox(), 'hill')
    await screen.findByRole('button', { name: /Hill repeats/ })

    expect(screen.queryByText(/activity data from garmin/i)).not.toBeInTheDocument()
  })

  it('drops to the connect form when the key is rejected mid-search', async () => {
    const user = typist()
    const store = fakeStore('revoked-key')
    const fetchImpl = stubApi({ status: { search: 401 } })
    renderPage({ store, fetchImpl })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })

    await user.type(searchBox(), 'hill')

    await waitFor(() => expect(screen.getByLabelText(/intervals\.icu api key/i)).toBeInTheDocument())
    expect(store.readApiKey()).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/didn't accept that api key/i)
  })

  it('banners a non-auth search failure and leaves the key alone', async () => {
    const user = typist()
    const store = fakeStore('stored-key')
    renderPage({ store, fetchImpl: stubApi({ status: { search: 429 } }) })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })

    await user.type(searchBox(), 'hill')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many requests/i))
    expect(store.readApiKey()).toBe('stored-key')
  })

  it('picks a search hit by id, the same ref the browse list dispatches', async () => {
    const user = typist()
    const onSelectActivity = vi.fn()
    await renderConnected({ fetchImpl: stubApi({ hits: [hillRepeats] }), onSelectActivity })

    await user.type(searchBox(), 'hill')
    await user.click(await screen.findByRole('button', { name: /Hill repeats/ }))

    expect(onSelectActivity).toHaveBeenCalledWith({
      type: 'id',
      provider: 'intervals',
      id: 'i7',
      name: 'Hill repeats',
    })
  })
})

// The range drives two things at once — the request bounds and a client-side
// predicate — so most of these assert both halves: what went over the wire,
// and what is left on screen. The stub deliberately keeps returning every
// fixture row whatever the request said, which is what makes the second half
// prove the predicate rather than the server.
//
// Date inputs are driven with fireEvent.change: userEvent.type drives the
// segmented editor, which jsdom does not implement.
describe('IntervalsPage — date range', () => {
  const listCalls = (fetchImpl) =>
    fetchImpl.mock.calls.filter(([url]) => url.includes('/activities') && !url.includes('/search-full'))
  const paramsOf = (call) => new URL(call[0]).searchParams

  const setRange = ({ from, to }) => {
    if (from !== undefined) fireEvent.change(screen.getByLabelText('From'), { target: { value: from } })
    if (to !== undefined) fireEvent.change(screen.getByLabelText('To'), { target: { value: to } })
  }

  async function renderConnected(props = {}) {
    const fetchImpl = props.fetchImpl ?? stubApi()
    renderPage({ store: fakeStore('stored-key'), ...props, fetchImpl })
    await screen.findByRole('button', { name: /Tempo 5×1k/ })
    return fetchImpl
  }

  // The filter is on before anyone touches it, and `newest` being *tomorrow*
  // is the easy half to miss: the `+1` rule applies to the default `to` too,
  // or the very first list drops everything recorded today.
  it('browses the last 90 days on first paint, ending tomorrow so today counts', async () => {
    const fetchImpl = await renderConnected()

    const params = paramsOf(listCalls(fetchImpl)[0])
    expect(params.get('oldest')).toBe(dayAgo(90))
    expect(params.get('newest')).toBe(dayAgo(-1))
    expect(screen.getByLabelText('From')).toHaveValue(dayAgo(90))
    expect(screen.getByLabelText('To')).toHaveValue(dayAgo(0))
  })

  it('asks for the named start day instead of the default floor', async () => {
    const fetchImpl = await renderConnected()
    const defaultOldest = paramsOf(listCalls(fetchImpl)[0]).get('oldest')

    setRange({ from: dayAgo(2) })

    await waitFor(() => expect(listCalls(fetchImpl)).toHaveLength(2))
    const params = paramsOf(listCalls(fetchImpl)[1])
    expect(params.get('oldest')).toBe(dayAgo(2))
    expect(params.get('oldest')).not.toBe(defaultOldest)
  })

  // The §5 rule, end to end: `newest` is midnight at the *start* of its day,
  // so an inclusive end has to leave here as the day after. "No start named"
  // now means the From field was emptied by hand — the only way back to an
  // open start, since ↺ restores the default rather than clearing.
  it('sends the end day plus one, and falls back to the 90-day floor when the start is emptied', async () => {
    const fetchImpl = await renderConnected()

    setRange({ from: '', to: dayAgo(1) })

    await waitFor(() => expect(paramsOf(listCalls(fetchImpl).at(-1)).get('newest')).toBe(dayAgo(0)))
    expect(paramsOf(listCalls(fetchImpl).at(-1)).get('oldest')).toBe(dayAgo(90))
  })

  // The same rule seen from the athlete's side: a one-day range around an
  // activity has to return that activity. Sending `newest` as that same day
  // would have dropped it.
  it('keeps an activity inside a single-day range', async () => {
    await renderConnected()

    setRange({ from: dayAgo(1), to: dayAgo(1) })

    expect(await screen.findByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sunday ride/ })).not.toBeInTheDocument()
  })

  // A narrower request never removes anything on its own: mergeById holds
  // every row it has ever seen, so the predicate is what makes the list obey.
  it('stops rendering a held row that falls outside the range', async () => {
    await renderConnected()
    expect(screen.getByRole('button', { name: /Sunday ride/ })).toBeInTheDocument()

    setRange({ from: dayAgo(2) })

    await waitFor(() => expect(screen.queryByRole('button', { name: /Sunday ride/ })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Tempo 5×1k/ })).toBeInTheDocument()
  })

  it('brings the held rows straight back when the range is reset', async () => {
    await renderConnected()
    setRange({ from: dayAgo(2) })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sunday ride/ })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /reset to the last 90 days/i }))

    // synchronously, from `activities` — no response has to land first
    expect(screen.getByRole('button', { name: /Sunday ride/ })).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveValue(dayAgo(90))
  })

  // The inversion of the old rule, decided deliberately: with the filter on by
  // default, hiding the button whenever `from` is set would remove paging
  // entirely. The range *is* the window now, so widening it is what paging is.
  it('pushes the From field back 90 days when "Load earlier activities" is pressed', async () => {
    const fetchImpl = await renderConnected()
    expect(screen.getByLabelText('From')).toHaveValue(dayAgo(90))

    fireEvent.click(screen.getByRole('button', { name: /load earlier activities/i }))

    // anchored on the oldest row held (i2, 3 days ago), so the floor lands at 93
    expect(screen.getByLabelText('From')).toHaveValue(dayAgo(93))
    await waitFor(() => expect(paramsOf(listCalls(fetchImpl).at(-1)).get('oldest')).toBe(dayAgo(93)))
    // and it is still offered — there is always more history to reach for
    expect(screen.getByRole('button', { name: /load earlier activities|loading…/i })).toBeInTheDocument()
  })

  it('keeps paging available whatever the range says, as long as we are browsing', async () => {
    await renderConnected()

    setRange({ from: dayAgo(2), to: dayAgo(1) })

    expect(await screen.findByRole('button', { name: /load earlier activities/i })).toBeInTheDocument()
  })

  it('names the range instead of claiming the last few months were empty', async () => {
    await renderConnected()

    setRange({ from: '2026-03-01', to: '2026-03-31' })

    expect(await screen.findByText('No activities between 1 Mar and 31 Mar 2026.')).toBeInTheDocument()
  })

  // Filling the second field is what inverts the range — the half-entered
  // state before it is a perfectly good one-ended range and does fetch. What
  // must not fetch is the inverted result, which matches nothing by
  // definition.
  it('fires no request for a range that ends before it starts', async () => {
    const fetchImpl = await renderConnected()
    setRange({ from: dayAgo(1) })
    await waitFor(() => expect(listCalls(fetchImpl)).toHaveLength(2))

    setRange({ to: dayAgo(30) })

    expect(screen.getByRole('alert')).toHaveTextContent(/end date is before the start date/i)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(listCalls(fetchImpl)).toHaveLength(2)
  })

  // Read in the state initialiser rather than an effect, which is what makes
  // the *first* request use the remembered range instead of the default. Uses
  // jsdom's real sessionStorage — setupTests.js clears it between tests.
  it('remembers a range across a remount, and requests it before the default', async () => {
    const first = await renderConnected()
    setRange({ from: dayAgo(2) })
    await waitFor(() => expect(paramsOf(listCalls(first).at(-1)).get('oldest')).toBe(dayAgo(2)))

    cleanup()
    const second = await renderConnected()

    expect(screen.getByLabelText('From')).toHaveValue(dayAgo(2))
    expect(paramsOf(listCalls(second)[0]).get('oldest')).toBe(dayAgo(2))
  })

  it('boots straight into a stored range rather than the default', async () => {
    sessionStorage.setItem(
      DATE_RANGE_STORAGE_KEY,
      JSON.stringify({ v: 1, from: dayAgo(2), to: dayAgo(1) }),
    )

    const fetchImpl = await renderConnected()

    const params = paramsOf(listCalls(fetchImpl)[0])
    expect(params.get('oldest')).toBe(dayAgo(2))
    expect(params.get('newest')).toBe(dayAgo(0))
    expect(screen.queryByRole('button', { name: /Sunday ride/ })).not.toBeInTheDocument()
  })

  // /search-full takes no date params, so the range can only be applied to the
  // hits it did return — see the comment on `shown` in IntervalsPage.jsx.
  it('filters search hits client-side and says which range emptied them', async () => {
    const user = userEvent.setup({ delay: null })
    const hillRepeats = { id: 'i7', name: 'Hill repeats', type: 'Run', start_date_local: daysAgo(10) }
    const fetchImpl = await renderConnected({ fetchImpl: stubApi({ hits: [hillRepeats] }) })

    await user.type(screen.getByLabelText(/search activities/i), 'hill')
    await screen.findByRole('button', { name: /Hill repeats/ })

    setRange({ from: '2026-03-01', to: '2026-03-31' })

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Hill repeats/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('No activities match "hill" between 1 Mar and 31 Mar 2026.')).toBeInTheDocument()
    // and the search itself was not re-run for a range it cannot express
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('/search-full'))).toHaveLength(1)
  })
})
