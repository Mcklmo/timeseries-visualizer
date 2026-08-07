import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntervalsActivityList, describeActivity, unsupportedReason } from './IntervalsActivityList.jsx'

const garminRun = {
  id: 'i1',
  name: 'Tempo 5×1k',
  type: 'Run',
  start_date_local: '2026-08-11T17:04:00',
  icu_distance: 12400,
  moving_time: 3492,
  file_type: 'fit',
  source: 'GARMIN_CONNECT',
  device_name: 'Forerunner 965',
}

function renderList(activities, props = {}) {
  return render(
    <IntervalsActivityList
      activities={activities}
      onSelect={() => {}}
      onLoadEarlier={() => {}}
      {...props}
    />,
  )
}

describe('describeActivity', () => {
  it('builds the secondary line from date, type, distance and duration', () => {
    expect(describeActivity(garminRun)).toBe('Tue 11 Aug · Run · 12.40 km · 58:12')
  })

  it('drops whatever the activity did not report, rather than printing placeholders', () => {
    expect(describeActivity({ id: 'i2', type: 'Ride', start_date_local: '2026-08-11T17:04:00' })).toBe(
      'Tue 11 Aug · Ride',
    )
    expect(describeActivity({ id: 'i3' })).toBe('')
    expect(describeActivity({ id: 'i4', start_date_local: 'not a date' })).toBe('')
  })

  it('falls back to elapsed_time when moving_time is absent', () => {
    expect(describeActivity({ id: 'i5', elapsed_time: 3492 })).toBe('58:12')
  })
})

describe('unsupportedReason', () => {
  it('passes a normal Garmin activity', () => {
    expect(unsupportedReason(garminRun)).toBeNull()
  })

  it('names Strava as the reason its original is missing', () => {
    expect(unsupportedReason({ id: 'i2', name: 'Ride', source: 'STRAVA' })).toMatch(/strava/i)
  })

  it('rejects a file type no parser handles', () => {
    expect(unsupportedReason({ id: 'i2', name: 'X', file_type: 'csv' })).toMatch(/file type isn't supported/i)
  })

  // GPX is a supported third format, so a GPX original is pickable — the
  // flip that landed with GPX support (ARCHITECTURE.md §8).
  it.each(['fit', 'tcx', 'gpx', 'FIT'])('accepts %s originals', (fileType) => {
    expect(unsupportedReason({ id: 'i2', name: 'X', start_date_local: '2026-08-11T17:04:00', file_type: fileType })).toBeNull()
  })

  // The bytes are the authority (detectActivityFormat.js); file_type is only
  // a pre-flight hint, so its absence must never disable a row.
  it('leaves a row without a file_type pickable', () => {
    expect(unsupportedReason({ id: 'i2', name: 'X', start_date_local: '2026-08-11T17:04:00' })).toBeNull()
  })

  it('explains an empty stub row', () => {
    expect(unsupportedReason({ id: 'i2' })).toMatch(/details aren't available/i)
  })
})

describe('IntervalsActivityList', () => {
  it('renders each activity as one button carrying its name and summary', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderList([garminRun], { onSelect })

    const row = screen.getByRole('button', { name: /Tempo 5×1k/ })
    expect(row).toHaveTextContent('Tue 11 Aug · Run · 12.40 km · 58:12')

    await user.click(row)
    expect(onSelect).toHaveBeenCalledWith(garminRun)
  })

  // Disabled with the reason as visible text, never hidden and never a title
  // tooltip: a tooltip is invisible on touch, and an activity the athlete
  // knows they recorded simply missing from the list reads as a bug.
  it('disables an unsupported row and shows why, in the row itself', () => {
    const strava = { id: 'i2', name: 'Strava ride', source: 'STRAVA' }
    renderList([garminRun, strava])

    const row = screen.getByRole('button', { name: /Strava ride/ })
    expect(row).toBeDisabled()
    expect(row).toHaveTextContent(/intervals\.icu doesn't keep the original file/i)
    expect(row).not.toHaveAttribute('title')
  })

  it('names an untitled activity rather than rendering a blank row', () => {
    renderList([{ id: 'i2', type: 'Run', start_date_local: '2026-08-11T17:04:00' }])
    expect(screen.getByRole('button', { name: /untitled activity/i })).toBeInTheDocument()
  })

  it('offers a button — not infinite scroll — to widen the window', async () => {
    const user = userEvent.setup()
    const onLoadEarlier = vi.fn()
    renderList([garminRun], { onLoadEarlier })

    await user.click(screen.getByRole('button', { name: /load earlier activities/i }))

    expect(onLoadEarlier).toHaveBeenCalled()
  })

  it('says so when the window held nothing, instead of rendering an empty list', () => {
    renderList([])
    expect(screen.getByText(/no activities in the last few months/i)).toBeInTheDocument()
  })
})
