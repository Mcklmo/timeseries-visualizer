import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { fullDomain } from '../domain/zoomDomain.js'
import { ActivityHeader } from './ActivityHeader.jsx'
import { AppProviders } from '../app/providers.jsx'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'

// Real samples and a real totalTime, not the empty stub this fixture used to
// be: the duration is read off the stats basis, which has nothing to slice
// without them.
const fixtureActivity = {
  id: 'a1',
  sport: 'running',
  name: 'Morning Run',
  // Local components, not a UTC literal — the header renders in the viewer's
  // zone, so a 'Z' timestamp would make these assertions TZ-dependent.
  startTime: new Date(2026, 7, 8, 7, 14),
  totalTime: 3725,
  totalMovingTime: 3725,
  totalDistance: 200,
  samples: [
    { t: 0, d: 0, speed: 4, moving: true },
    { t: 1800, d: 100, speed: 5, moving: true },
    { t: 3725, d: 200, speed: 3, moving: true },
  ],
  availableMetrics: ['pace'],
}

function makeSource(activity) {
  return { kind: 'mock', load: () => Promise.resolve(activity) }
}

function Loader() {
  const { load } = useActivity()
  useEffect(() => {
    load({ type: 'id', id: 'x' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// Drives the zoom the way the pinch gesture does — by writing the one
// zoomDomain — without needing a real gesture over a chart that isn't
// rendered here.
function ZoomTo({ domain }) {
  const { setZoomDomain } = useChartView()
  return <button onClick={() => setZoomDomain(domain)}>zoom</button>
}

function ResetZoom() {
  const { setZoomDomain } = useChartView()
  return <button onClick={() => setZoomDomain(fullDomain())}>reset</button>
}

function SwitchXMode({ mode }) {
  const { setXMode } = useChartView()
  return <button onClick={() => setXMode(mode)}>switch-x-{mode}</button>
}

describe('ActivityHeader', () => {
  it('renders nothing before the activity has loaded', () => {
    const { container } = render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <ActivityHeader />
      </AppProviders>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the inferred name and a "Running" chip for a running activity', async () => {
    render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('Morning Run')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders a "Cycling" chip for a cycling activity', async () => {
    const cycling = { ...fixtureActivity, sport: 'cycling', name: 'Evening Ride' }
    render(
      <AppProviders source={makeSource(cycling)}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('Evening Ride')).toBeInTheDocument()
    expect(screen.getByText('Cycling')).toBeInTheDocument()
  })

  it('renders a "Track" chip for a GPS-only track', async () => {
    const track = { ...fixtureActivity, sport: 'track', name: '3-day Track' }
    render(
      <AppProviders source={makeSource(track)}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('3-day Track')).toBeInTheDocument()
    expect(screen.getByText('Track')).toBeInTheDocument()
  })

  it('renders when the activity was recorded, and its elapsed total', async () => {
    render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('8 Aug 2026, 07:14')).toBeInTheDocument()
    expect(screen.getByText('1:02:05')).toBeInTheDocument()
  })

  // An activity whose file carried no usable timestamp must render no date
  // element at all — 'Invalid Date' pinned to a screenshot is worse than an
  // absent date.
  it('omits the date entirely when there is no start time', async () => {
    const { container } = render(
      <AppProviders source={makeSource({ ...fixtureActivity, startTime: undefined })}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('Morning Run')).toBeInTheDocument()
    expect(container.querySelector('.activity-datetime')).toBeNull()
    expect(screen.getByText('1:02:05')).toBeInTheDocument()
  })

  // The point of putting the duration here: a screenshot of a zoomed interval
  // has to say how long *that* interval is, and the number comes from the same
  // FUNCTION the stat chips do — so it windows silently, with no "zoomed"
  // marker.
  //
  // The waitFor this used to need is gone, since the duration no longer comes
  // off the deferred basis. Do NOT read that as the regression guard, though:
  // a single setZoomDomain inside act() settles a deferred render too, so this
  // would stay green either way. What the live path actually buys is only
  // visible under a *continuous* stream of urgent updates, and is pinned by
  // 'updates the header duration mid-gesture, ahead of the chips' in
  // ChartStack.test.jsx, against a real pinch.
  it('narrows the duration to the zoom window', async () => {
    const user = userEvent.setup()
    render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <Loader />
        <ZoomTo domain={[0, 1800]} />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('1:02:05')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'zoom' }))

    expect(screen.getByText('30:00')).toBeInTheDocument()
    expect(screen.queryByText('1:02:05')).not.toBeInTheDocument()
    // and the start time is identity, not a window — it does not move
    expect(screen.getByText('8 Aug 2026, 07:14')).toBeInTheDocument()
  })

  // A distance window still has to report a time: the axis may be metres, the
  // duration never is (elapsedTimeFor measures in `t` whichever axis shows).
  it('reports a time for a distance window', async () => {
    const user = userEvent.setup()
    render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <Loader />
        <SwitchXMode mode="distance" />
        <ZoomTo domain={[0, 100]} />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('1:02:05')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'switch-x-distance' }))
    await user.click(screen.getByRole('button', { name: 'zoom' }))

    // 0–100 m covers the samples at t=0 and t=1800.
    expect(screen.getByText('30:00')).toBeInTheDocument()
  })

  it('returns to the whole activity when the zoom is reset', async () => {
    const user = userEvent.setup()
    render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <Loader />
        <ZoomTo domain={[0, 1800]} />
        <ResetZoom />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('1:02:05')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'zoom' }))
    expect(screen.getByText('30:00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'reset' }))
    expect(screen.getByText('1:02:05')).toBeInTheDocument()
  })
})
