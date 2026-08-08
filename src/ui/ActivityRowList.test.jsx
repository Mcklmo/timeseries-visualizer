import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityRowList, describeActivity } from './ActivityRowList.jsx'

/** A full row, as a provider's mapper would hand it over. */
function row(overrides = {}) {
  return {
    id: 'i1',
    name: 'Tempo 5×1k',
    startedAt: '2026-08-11T17:04:00',
    distanceM: 12400,
    durationS: 3492,
    sportLabel: 'Run',
    unsupportedReason: null,
    isGarminDerived: true,
    ...overrides,
  }
}

/** The other end of the range every field spans: only `id` is guaranteed. */
function stub(overrides = {}) {
  return {
    id: 'i2',
    startedAt: null,
    distanceM: null,
    durationS: null,
    sportLabel: null,
    unsupportedReason: null,
    isGarminDerived: false,
    ...overrides,
  }
}

function renderList(rows, props = {}) {
  return render(<ActivityRowList rows={rows} onSelect={() => {}} onLoadEarlier={() => {}} {...props} />)
}

describe('describeActivity', () => {
  it('builds the secondary line from date, sport, distance and duration', () => {
    expect(describeActivity(row())).toBe('Tue 11 Aug 2026 · Run · 12.40 km · 58:12')
  })

  it('drops whatever the activity did not report, rather than printing placeholders', () => {
    expect(describeActivity(stub({ sportLabel: 'Ride', startedAt: '2026-08-11T17:04:00' }))).toBe(
      'Tue 11 Aug 2026 · Ride',
    )
    expect(describeActivity(stub())).toBe('')
    expect(describeActivity(stub({ startedAt: 'not a date' }))).toBe('')
  })

  // The date filter puts any year on screen, so the year is stated on every
  // row — an older activity must not read as one from this year.
  it('names the year even on an activity from a past season', () => {
    expect(describeActivity(stub({ sportLabel: 'Run', startedAt: '2024-03-02T08:15:00' }))).toBe(
      'Sat 2 Mar 2024 · Run',
    )
  })

  // The mapper has already turned every unusable measurement into null, so
  // this side asks nothing beyond "did it say".
  it('renders a measurement the moment it is present, with no second guard', () => {
    expect(describeActivity(stub({ distanceM: 8000, durationS: 2400 }))).toBe('8.00 km · 40:00')
  })
})

describe('ActivityRowList', () => {
  it('renders each activity as one button carrying its name and summary', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const tempo = row()
    renderList([tempo], { onSelect })

    const button = screen.getByRole('button', { name: /Tempo 5×1k/ })
    expect(button).toHaveTextContent('Tue 11 Aug 2026 · Run · 12.40 km · 58:12')

    await user.click(button)
    expect(onSelect).toHaveBeenCalledWith(tempo)
  })

  // Disabled with the reason as visible text, never hidden and never a title
  // tooltip: a tooltip is invisible on touch, and an activity the athlete
  // knows they recorded simply missing from the list reads as a bug.
  it('disables an unsupported row and shows why, in the row itself', () => {
    const strava = stub({
      name: 'Strava ride',
      unsupportedReason: "Synced from Strava — intervals.icu doesn't keep the original file.",
    })
    renderList([row(), strava])

    const button = screen.getByRole('button', { name: /Strava ride/ })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent(/intervals\.icu doesn't keep the original file/i)
    expect(button).not.toHaveAttribute('title')
  })

  it('names an untitled activity rather than rendering a blank row', () => {
    renderList([stub({ sportLabel: 'Run', startedAt: '2026-08-11T17:04:00' })])
    expect(screen.getByRole('button', { name: /untitled activity/i })).toBeInTheDocument()
  })

  it('offers a button — not infinite scroll — to widen the window', async () => {
    const user = userEvent.setup()
    const onLoadEarlier = vi.fn()
    renderList([row()], { onLoadEarlier })

    await user.click(screen.getByRole('button', { name: /load earlier activities/i }))

    expect(onLoadEarlier).toHaveBeenCalled()
  })

  it('says so when the window held nothing, instead of rendering an empty list', () => {
    renderList([])
    expect(screen.getByText(/no activities in the last few months/i)).toBeInTheDocument()
  })

  // Search hits are scattered through history rather than bounded by a
  // window, so "earlier" has no meaning and the button must not be there to
  // press.
  it('drops the widen button entirely when there is no window to widen', () => {
    renderList([row()], { onLoadEarlier: undefined })
    expect(screen.queryByRole('button', { name: /load earlier activities/i })).not.toBeInTheDocument()
  })

  it('takes a caller-supplied empty message, so "no matches" never reads as "no recent activities"', () => {
    renderList([], { emptyMessage: 'No activities match "hill".' })

    expect(screen.getByText('No activities match "hill".')).toBeInTheDocument()
    expect(screen.queryByText(/last few months/i)).not.toBeInTheDocument()
  })
})
