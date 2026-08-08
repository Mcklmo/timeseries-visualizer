// Deliberately small. IntervalsPage.test.jsx already drives this hook through
// the real page for 41 tests, and that is the right level for anything the
// athlete can see. What is left here is the handful of properties that are
// awkward to reach that way — a rejection arriving down one read path rather
// than the other, a request that must *not* have been made, and a merge
// spanning two windows.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toApiDate } from '../data/activityDateRange.js'
import { useIntervalsActivities } from './useIntervalsActivities.js'

// Every fixture is relative to now for the same reason IntervalsPage's are:
// the default range is the last 90 days, so a pinned date starts failing on
// some future run.
const dayAgo = (n) => {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return toApiDate(date)
}
const daysAgo = (n) => `${dayAgo(n)}T09:00:00`

function fakeStore(initialKey = null) {
  const map = new Map(initialKey ? [['k', initialKey]] : [])
  return {
    readApiKey: () => map.get('k') ?? null,
    saveApiKey: (key) => (map.set('k', key), true),
    clearApiKey: () => map.delete('k'),
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const tempo = { id: 'i1', name: 'Tempo 5×1k', type: 'Run', start_date_local: daysAgo(1) }

/**
 * Both seams are built **once**, outside the render callback. `store` sits in
 * `rejectKey`'s dep array and `rejectKey` in both effects', so a fresh store
 * per render re-fires the browse request on every render — an unbounded
 * request loop rather than a test failure. IntervalsPage gets the same
 * stability for free, from props.
 */
function renderPicker({ store = fakeStore('stored-key'), fetchImpl } = {}) {
  return renderHook(() => useIntervalsActivities({ store, fetchImpl }))
}

describe('useIntervalsActivities', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => vi.useRealTimers())

  it('maps both read paths into rows, so nothing downstream sees a wire field', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ ...tempo, icu_distance: 12400 }]))
    const { result } = renderPicker({ fetchImpl })

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.rows[0]).toMatchObject({
      id: 'i1',
      startedAt: daysAgo(1),
      distanceM: 12400,
      sportLabel: 'Run',
    })
    expect(result.current.rows[0]).not.toHaveProperty('icu_distance')
  })

  // One 401 is terminal for that key whichever request met it — the browse
  // effect and the search effect share `rejectKey` precisely so a rejection
  // cannot be handled two different ways.
  it.each([
    ['the browse path', () => {}],
    ['the search path', (result) => act(() => result.current.setQuery('hill'))],
  ])('clears the stored key on a 401 from %s', async (_name, provoke) => {
    const store = fakeStore('revoked-key')
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }))
    const { result } = renderPicker({ store, fetchImpl })

    provoke(result)

    await waitFor(() => expect(result.current.apiKey).toBeNull())
    expect(store.readApiKey()).toBeNull()
    expect(result.current.notice).toMatch(/didn't accept that api key/i)
  })

  // The browse effect keys on the request bounds, which searching never
  // touches. This is what makes clearing the box a zero-request return to
  // browsing, and it is invisible from the page except as a call count.
  it('leaves the browse request alone while a search runs', async () => {
    const fetchImpl = vi.fn(async (url) =>
      jsonResponse(url.includes('/search-full') ? [{ id: 'i7', name: 'Hill repeats', start_date_local: daysAgo(5) }] : [tempo]),
    )
    const { result } = renderPicker({ fetchImpl })
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    const browseCalls = () => fetchImpl.mock.calls.filter(([url]) => !url.includes('/search-full')).length
    const before = browseCalls()

    act(() => result.current.setQuery('hill'))
    await waitFor(() => expect(result.current.rows[0].name).toBe('Hill repeats'))
    act(() => result.current.setQuery(''))

    await waitFor(() => expect(result.current.rows[0].name).toBe('Tempo 5×1k'))
    expect(browseCalls()).toBe(before)
  })

  // The property that makes ↺ instant: a widened window re-returns everything
  // already held, and the merge keeps one copy of each without a round trip.
  it('accumulates across widened windows without duplicating the overlap', async () => {
    const older = { id: 'i3', name: 'Long run', type: 'Run', start_date_local: daysAgo(91) }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([tempo]))
      .mockResolvedValueOnce(jsonResponse([tempo, older]))
    const { result } = renderPicker({ fetchImpl })
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    act(() => result.current.loadEarlier())

    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(result.current.rows.map((row) => row.id)).toEqual(['i1', 'i3'])
    // anchored on the oldest row held (1 day ago), so the floor lands at 91
    expect(result.current.range.from).toBe(dayAgo(91))
  })

  // A held row stops rendering the moment the range narrows, because a
  // narrower request never removes anything on its own.
  it('keeps a narrowed-out row in memory and brings it straight back', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([tempo, { id: 'i2', name: 'Sunday ride', start_date_local: daysAgo(30) }]))
    const { result } = renderPicker({ fetchImpl })
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    const wide = result.current.range

    act(() => result.current.setRange({ from: dayAgo(2), to: dayAgo(0) }))
    expect(result.current.rows.map((row) => row.id)).toEqual(['i1'])

    act(() => result.current.setRange(wide))
    // synchronously, with no response having to land first
    expect(result.current.rows.map((row) => row.id)).toEqual(['i1', 'i2'])
  })
})
