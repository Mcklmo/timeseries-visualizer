import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App, { AppShell } from './App.jsx'
import { AppProviders } from './app/providers.jsx'
import { API_KEY_STORAGE_KEY } from './data/intervals/credentialStore.js'

// App wires the real credentialStore, which is backed by jsdom's real
// localStorage — so "not connected" has to be established rather than assumed.
beforeEach(() => window.localStorage.removeItem(API_KEY_STORAGE_KEY))

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

// A GPS-only track: no <type>, no sensor channels, position + elevation +
// time only — the shape a satellite messenger or camera exports.
const validGpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Test track</name>
    <trkseg>
      <trkpt lat="57.010000" lon="9.970000"><ele>12.0</ele><time>2026-01-01T00:00:00.000Z</time></trkpt>
      <trkpt lat="57.010135" lon="9.970000"><ele>13.0</ele><time>2026-01-01T00:00:10.000Z</time></trkpt>
      <trkpt lat="57.010270" lon="9.970000"><ele>14.0</ele><time>2026-01-01T00:00:20.000Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

// Valid GPX, but a planned route rather than a recording: <time> is optional
// in GPX, and without it there is no axis to plot anything against.
const routeGpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="57.010000" lon="9.970000"><ele>12.0</ele></trkpt>
    <trkpt lat="57.010135" lon="9.970000"><ele>13.0</ele></trkpt>
  </trkseg></trk>
</gpx>`

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
    expect(screen.getByRole('heading', { name: /ActivityMaxxer/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /load an activity/i })).toBeInTheDocument()
    expect(container.querySelector('header .load-activity-bar')).toBeNull()
  })

  it('marks the header faded once the page scrolls (collapsing the load-activity bar, per global.css), and un-fades back at the top', () => {
    render(<App />)
    const heading = screen.getByRole('heading', { name: /ActivityMaxxer/i })
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

  // The lockup is what makes a mid-scroll screenshot attributable: once
  // faded, the header's bar is gone and the h1 plus its mark is all that's
  // left identifying the app. The mark lives *inside* the heading so it
  // travels with it, and is aria-hidden so it adds nothing to the accessible
  // name every other test queries by.
  it('renders the brand mark inside the h1, hidden from the accessible name', () => {
    render(<App />)
    const heading = screen.getByRole('heading', { name: /^ActivityMaxxer$/i })
    const mark = heading.querySelector('svg.brand-mark')
    expect(mark).toBeInTheDocument()
    expect(mark).toHaveAttribute('aria-hidden', 'true')
  })

  // About is no longer a view — it is a static page at /about, prerendered by
  // scripts/build-seo-pages.mjs. What the app still owes it is a real href: it
  // is the only internal link a crawler can follow off the app shell, and a
  // <button> that swapped state would be invisible to one. Asserting the
  // element and its target is therefore the whole contract from this side; the
  // prose itself is pinned by scripts/seo/pages.test.mjs.
  it('links About to the static /about page rather than swapping a view', () => {
    render(<App />)

    const about = screen.getByRole('link', { name: /^about$/i })
    expect(about).toHaveAttribute('href', '/about')
    // and nothing in the app renders the prose any more — one About, one URL
    expect(screen.queryByText(/runs entirely in your browser/i)).not.toBeInTheDocument()
  })

  it('shows the intervals.icu page from the header link and returns via Back', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: /^intervals\.icu$/i }))
    expect(screen.getByLabelText(/intervals\.icu api key/i)).toBeInTheDocument()
    // same invariant as About: <main> is replaced, so the header takes the
    // load control back
    expect(screen.queryByRole('heading', { name: /load an activity/i })).not.toBeInTheDocument()
    expect(container.querySelector('header .load-activity-bar')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: /^←\s*back$/i }))
    expect(screen.queryByLabelText(/intervals\.icu api key/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /load an activity/i })).toBeInTheDocument()
  })

  it('reaches the intervals.icu page from the empty state CTA too', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /load from intervals\.icu/i }))

    expect(screen.getByLabelText(/intervals\.icu api key/i)).toBeInTheDocument()
  })

  // The one-FileDropZone invariant (AppShell's showEmptyState comment) has to
  // hold in every view: a DOM id collision, three getByLabelText queries that
  // throw on two matches, and two competing CTAs on the idle page all ride
  // on it.
  it('keeps exactly one FileDropZone mounted in both views', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const zoneCount = () => container.querySelectorAll('input[type="file"]').length

    expect(zoneCount()).toBe(1) // activity (idle: the hero)

    await user.click(screen.getByRole('button', { name: /^intervals\.icu$/i }))
    expect(zoneCount()).toBe(1) // intervals (header control)

    await user.click(screen.getByRole('button', { name: /^←\s*back$/i }))
    expect(zoneCount()).toBe(1) // back to the hero
  })

  // Pins the opt-in privacy stance mechanically rather than by convention:
  // nothing about booting the app, or about the file path, may touch the
  // network. Safe today because Turnstile loads via a <script> tag and only
  // once the feedback dialog is opened.
  it('issues no network request at boot, or when a file is dropped', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('the offline path must not reach the network')
    })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const { container } = render(<App />)
      expect(fetchSpy).not.toHaveBeenCalled()

      fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
        target: { files: [makeFile()] },
      })
      await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
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

  it('routes a dropped .gpx to the GPX parser, not the TCX one', async () => {
    const { container } = render(<App />)

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [new File([validGpxXml], 'track.gpx', { type: 'application/gpx+xml' })] },
    })

    await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))
    // Sport, panels and chip all differ from the TCX path: a GPS-only track
    // has no <type>, so it gets the generic 'track' sport, which shows Speed
    // rather than Pace and offers none of the sensor metrics.
    expect(screen.getByText('Track')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Speed' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Elevation' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Pace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Heart rate' })).not.toBeInTheDocument()
  })

  it('shows the GPX parser\'s route-not-a-track error for a timestamp-less .gpx', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [new File([routeGpxXml], 'route.gpx', { type: 'application/gpx+xml' })] },
    })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/route or waypoint list/i))
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

  // The seam ARCHITECTURE.md §5 has anticipated since day one: the picker
  // produces an {type:'id'} ref, the dispatcher routes it, and the optional
  // `name` carries intervals.icu's real title through — without it, tapping
  // "Tempo 5×1k" and landing on a chart headed "Morning Run" reads as a bug.
  it('dispatches an id ref, with the real title, when an intervals.icu activity is picked', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(API_KEY_STORAGE_KEY, 'stored-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { id: 'i77', name: 'Tempo 5×1k', type: 'Run', start_date_local: '2026-08-11T17:04:00' },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const load = vi.fn().mockResolvedValue(fixtureActivity)

    try {
      renderShell({ kind: 'mock', load })

      await user.click(screen.getByRole('button', { name: /^intervals\.icu$/i }))
      await user.click(await screen.findByRole('button', { name: /Tempo 5×1k/ }))

      expect(load).toHaveBeenCalledWith({ type: 'id', id: 'i77', name: 'Tempo 5×1k' })
      // and it leaves the picker, so the chart is what the user lands on
      await waitFor(() => expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument())
    } finally {
      vi.unstubAllGlobals()
      window.localStorage.removeItem(API_KEY_STORAGE_KEY)
    }
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
