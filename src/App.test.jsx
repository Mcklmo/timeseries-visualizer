import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App, { AppShell } from './App.jsx'
import { AppProviders } from './app/providers.jsx'

const validTcxXml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-01-01T00:00:00.000Z</Id>
      <Lap StartTime="2026-01-01T00:00:00.000Z">
        <Track>
          <Trackpoint>
            <Time>2026-01-01T00:00:00.000Z</Time>
            <DistanceMeters>0.0</DistanceMeters>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
            <Extensions><ns3:TPX><ns3:Speed>3.0</ns3:Speed><ns3:RunCadence>85</ns3:RunCadence></ns3:TPX></Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-01-01T00:00:10.000Z</Time>
            <DistanceMeters>30.0</DistanceMeters>
            <HeartRateBpm><Value>125</Value></HeartRateBpm>
            <Extensions><ns3:TPX><ns3:Speed>3.0</ns3:Speed><ns3:RunCadence>86</ns3:RunCadence></ns3:TPX></Extensions>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

function makeFile(name = 'run.tcx') {
  return new File([validTcxXml], name, { type: 'application/vnd.garmin.tcx+xml' })
}

// jsdom doesn't implement window.scrollTo, and window.scrollY has no setter —
// redefine it directly so tests can simulate a scroll position.
function setScrollY(value) {
  Object.defineProperty(window, 'scrollY', { value, writable: true, configurable: true })
}

// Small hand-built fixture (same shape as ControlPanel.test.jsx's) for the
// tests below that need control over the ActivitySource itself (loading /
// error timing) — the real App wiring is exercised separately against the
// actual TCX parser, driven by the hand-written validTcxXml above.
const fixtureActivity = {
  id: 'a1',
  sport: 'running',
  totalMovingTime: 40,
  totalDistance: 200,
  samples: [
    { t: 0, d: 0, speed: 4, heartRate: 120, cadence: 170, altitude: 10, moving: true },
    { t: 10, d: 50, speed: 5, heartRate: 130, cadence: 172, altitude: 12, moving: true },
    { t: 20, d: 100, speed: 6, heartRate: 150, cadence: 174, altitude: 14, moving: true },
    { t: 30, d: 150, speed: 5, heartRate: 140, cadence: 176, altitude: 16, moving: true },
    { t: 40, d: 200, speed: 3, heartRate: 110, cadence: 178, altitude: 18, moving: true },
  ],
  availableMetrics: ['pace', 'heartRate', 'cadence', 'altitude'],
}

describe('App (wired against the real TCX/FIT sources)', () => {
  // Pins the invariant AppShell's `showEmptyState` comment describes: exactly
  // one FileDropZone is mounted at a time. On the idle page it's the hero, and
  // the header must hold no second one — two CTAs is the layout problem this
  // replaced, and two mounted zones would give getByLabelText below two
  // matches to pick between.
  it('shows the empty state — and nothing in the header — before any activity is loaded', () => {
    const { container } = render(<App />)
    expect(screen.getByRole('heading', { name: /activity visualiser/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /load an activity/i })).toBeInTheDocument()
    expect(container.querySelector('header .load-activity-bar')).toBeNull()
  })

  it('marks the header faded once the page scrolls (collapsing the load-activity bar, per global.css), and un-fades back at the top', () => {
    render(<App />)
    const heading = screen.getByRole('heading', { name: /activity visualiser/i })
    const header = heading.closest('header')
    expect(header).not.toHaveClass('app-header--faded')

    // jsdom doesn't implement window.scrollTo/layout, so drive the scroll
    // position `useIsScrolled` reads directly, same as a real scroll would.
    setScrollY(200)
    fireEvent.scroll(window)
    expect(header).toHaveClass('app-header--faded')
    // The h1 itself is exempt from the fade — it stays put as a watermark.
    // Whatever else the header holds collapses away via the CSS descendant
    // selector `.app-header--faded .load-activity-bar`, not React state; on
    // this idle page that's nothing, since the drop zone is the hero in <main>.
    expect(heading).toBeVisible()

    setScrollY(0)
    fireEvent.scroll(window)
    expect(header).not.toHaveClass('app-header--faded')
  })

  it('shows the About page from the header link and returns via Back', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: /^about$/i }))
    expect(screen.getByText(/runs entirely in your browser/i)).toBeInTheDocument()
    // About replaces the whole of <main>, hero included — so the header picks
    // the control back up (the `!showAbout` term in AppShell's showEmptyState),
    // or a visitor who opened About on a fresh page could load nothing at all.
    expect(screen.queryByRole('heading', { name: /load an activity/i })).not.toBeInTheDocument()
    expect(container.querySelector('header .load-activity-bar')).not.toBeNull()

    // anchored, since the footer's "Feedback" trigger also contains "back"
    await user.click(screen.getByRole('button', { name: /^←\s*back$/i }))
    expect(screen.queryByText(/runs entirely in your browser/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /load an activity/i })).toBeInTheDocument()
  })

  it('loads a dropped TCX file end-to-end through the real parser', async () => {
    const { container } = render(<App />)

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [makeFile()] },
    })

    await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))
    // the dropped fixture only has pace/heartRate/cadence — no power, no altitude —
    // which only holds if this went through the real TcxActivitySource
    expect(screen.getByRole('checkbox', { name: 'Pace' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Cadence' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Elevation' })).not.toBeInTheDocument()
    // with the hero gone, the compact header control has taken over, so a
    // different activity can still be loaded without leaving the chart view
    expect(container.querySelector('header .load-activity-bar')).not.toBeNull()
  })

  it('shows the parser\'s error for a malformed dropped file', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [new File(['not xml'], 'bad.tcx', { type: 'application/vnd.garmin.tcx+xml' })] },
    })

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})

describe('AppShell (controlled source, for states the real parsers never produce on demand)', () => {
  function renderShell(source) {
    return render(
      <AppProviders source={source}>
        <AppShell />
      </AppProviders>,
    )
  }

  // The injected source double ignores the ref entirely, so picking a file in
  // whichever drop zone is currently mounted drives every status path.
  function pickFile() {
    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [makeFile()] },
    })
  }

  it('shows a loading indicator between requesting and resolving an activity', async () => {
    let resolveLoad
    const load = () => new Promise((resolve) => (resolveLoad = resolve))
    renderShell({ kind: 'mock', load })

    pickFile()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    resolveLoad(fixtureActivity)
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument())
  })

  it('shows an error state when the source rejects, without leaving stale loading/empty UI behind', async () => {
    const load = vi.fn().mockRejectedValue(new Error('unsupported TCX schema'))
    renderShell({ kind: 'mock', load })

    pickFile()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/unsupported tcx schema/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
  })

  // The footer sits outside the status switch on purpose — someone staring at
  // an error is exactly who most needs to report it.
  it('keeps the feedback trigger in the footer across idle, loading, error and ready', async () => {
    const user = userEvent.setup()
    let settle
    const load = vi.fn(() => new Promise((resolve, reject) => (settle = { resolve, reject })))
    const { container } = renderShell({ kind: 'mock', load })
    const feedbackTrigger = () => screen.queryByRole('button', { name: /^feedback$/i })

    expect(feedbackTrigger()).toBeInTheDocument() // idle

    pickFile()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(feedbackTrigger()).toBeInTheDocument() // loading

    await act(async () => settle.reject(new Error('unsupported TCX schema')))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(feedbackTrigger()).toBeInTheDocument() // error

    await user.click(screen.getByRole('button', { name: /try again/i }))
    await act(async () => settle.resolve(fixtureActivity))
    await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))
    expect(feedbackTrigger()).toBeInTheDocument() // ready
  })

  it('retries the same load on demand from the error state', async () => {
    const user = userEvent.setup()
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('unsupported TCX schema'))
      .mockResolvedValueOnce(fixtureActivity)
    const { container } = renderShell({ kind: 'mock', load })

    pickFile()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    // replays the same {type:'file'} ref through lastRef — hence two calls
    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
