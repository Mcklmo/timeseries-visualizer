import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { ChartViewProvider, useChartView } from './ChartViewContext.jsx'
import { useActivity } from './ActivityContext.jsx'
import { AppProviders } from '../app/providers.jsx'
import { metricOrder } from '../metrics/metricRegistry.js'

const noStats = JSON.stringify(Object.fromEntries(metricOrder.map((id) => [id, []])))

function Probe() {
  const view = useChartView()
  return (
    <div>
      <div>xMode:{view.xMode}</div>
      <div>zoomDomain:{JSON.stringify(view.zoomDomain)}</div>
      <div>viewDomain:{JSON.stringify(view.viewDomain)}</div>
      <div>enabledMetrics:{JSON.stringify(view.enabledMetrics)}</div>
      <div>enabledStats:{JSON.stringify(view.enabledStats)}</div>
      {/* The whole published surface, so a field that nothing reads cannot
          quietly reappear — see the `hoverIndex` case below. */}
      <div>keys:{Object.keys(view).sort().join(',')}</div>
      <button onClick={() => view.setXMode('distance')}>setXMode</button>
      {/* The window and the plotted view are written together, always: see
          setZoom in the provider for why they may never be committed apart. */}
      <button onClick={() => view.setZoom([10, 20], [5, 25])}>setZoom</button>
      <button onClick={() => view.toggleMetric('pace')}>toggleMetricPace</button>
      <button onClick={() => view.toggleStat('heartRate', 'max')}>toggleHrMax</button>
      <button onClick={() => view.toggleStat('pace', 'avg')}>togglePaceAvg</button>
    </div>
  )
}

// ChartViewProvider reads ActivityContext (it keys the remembered view on
// activity.id), so a bare <ChartViewProvider> would now throw — every render
// goes through AppProviders with a source double, the same pattern the UI
// suites use.
function makeSource(activity) {
  return { kind: 'mock', load: () => Promise.resolve(activity) }
}

/** Renders with nothing loaded: the setters below are activity-independent. */
function renderProbe() {
  return render(
    <AppProviders source={makeSource(null)}>
      <Probe />
    </AppProviders>,
  )
}

describe('ChartViewContext', () => {
  it('defaults to time mode, full zoom domain, and every metric enabled', () => {
    renderProbe()
    expect(screen.getByText('xMode:time')).toBeInTheDocument()
    expect(screen.getByText('zoomDomain:["dataMin","dataMax"]')).toBeInTheDocument()
    expect(screen.getByText(`enabledMetrics:${JSON.stringify(metricOrder)}`)).toBeInTheDocument()
  })

  it('defaults every stat off, so a freshly opened activity shows no reference lines or chips', () => {
    renderProbe()
    expect(screen.getByText(`enabledStats:${noStats}`)).toBeInTheDocument()
  })

  it('setXMode switches between time and distance', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setXMode'))
    expect(screen.getByText('xMode:distance')).toBeInTheDocument()
  })

  it('setZoom replaces the controlled window wholesale', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setZoom'))
    expect(screen.getByText('zoomDomain:[10,20]')).toBeInTheDocument()
  })

  it('setZoom commits the window and the plotted view in ONE update', async () => {
    // The reason this is one setter and not two: a render landing between them
    // would draw a window outside its own plotted range, i.e. a drag handle off
    // the edge of the chart.
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setZoom'))
    expect(screen.getByText('zoomDomain:[10,20]')).toBeInTheDocument()
    expect(screen.getByText('viewDomain:[5,25]')).toBeInTheDocument()
  })

  it('setXMode resets both the window and the view to the full range', async () => {
    // A numeric zoomDomain from one mode (e.g. seconds) is meaningless in
    // the other (metres) — carrying it across would silently misclip the
    // axis, so switching modes resets zoom instead.
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setZoom'))
    expect(screen.getByText('zoomDomain:[10,20]')).toBeInTheDocument()
    await user.click(screen.getByText('setXMode'))
    expect(screen.getByText('zoomDomain:["dataMin","dataMax"]')).toBeInTheDocument()
    expect(screen.getByText('viewDomain:["dataMin","dataMax"]')).toBeInTheDocument()
  })

  it('toggleMetric removes an enabled metric, then re-adds it on a second toggle', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('toggleMetricPace'))
    expect(screen.getByText(`enabledMetrics:${JSON.stringify(metricOrder.filter((m) => m !== 'pace'))}`)).toBeInTheDocument()

    await user.click(screen.getByText('toggleMetricPace'))
    expect(screen.getByText(`enabledMetrics:${JSON.stringify(metricOrder)}`)).toBeInTheDocument()
  })

  it('toggleStat is per-metric: enabling max on heartRate does not affect pace', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('toggleHrMax'))
    expect(
      screen.getByText(
        'enabledStats:{"pace":[],"speed":[],"heartRate":["max"],"power":[],"cadence":[],"altitude":[]}',
      ),
    ).toBeInTheDocument()
  })

  it('toggleStat removes a stat that is already enabled', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('togglePaceAvg'))
    expect(
      screen.getByText('enabledStats:{"pace":["avg"],"speed":[],"heartRate":[],"power":[],"cadence":[],"altitude":[]}'),
    ).toBeInTheDocument()

    await user.click(screen.getByText('togglePaceAvg'))
    expect(screen.getByText(`enabledStats:${noStats}`)).toBeInTheDocument()
  })

  // `hoverIndex`/`setHoverIndex` used to be asserted here. They were the
  // documented seam for an external readout and never had a reader; the fixed
  // crosshair label that finally wanted one reads Recharts' own hover instead,
  // so publishing it through this context would re-render every chart in the
  // stack per mouse-move frame. See ui/CrosshairReadout.jsx.
  it('publishes no hoverIndex, since nothing reads one', () => {
    renderProbe()
    expect(screen.getByText(/^keys:/).textContent).toBe(
      'keys:basemap,enabledMetrics,enabledStats,setBasemap,setXMode,setZoom,showMap,toggleMap,toggleMetric,' +
        'toggleStat,viewDomain,xMode,zoomDomain',
    )
  })

  it('throws a clear error when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ChartViewProvider/)
    spy.mockRestore()
  })

  it('throws when nested outside ActivityProvider, since it now reads the loaded activity', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <ChartViewProvider>
          <Probe />
        </ChartViewProvider>,
      ),
    ).toThrow(/ActivityProvider/)
    spy.mockRestore()
  })
})

// Only `activity.id` matters here — the view is keyed on it and nothing in
// this file renders a chart.
const activityA = { id: 'running-20260807T0712Z-3847s-3f2a9c1b', sport: 'running', samples: [], availableMetrics: [] }
const activityB = { id: 'cycling-20260101T0900Z-1200s-5e7d1a04', sport: 'cycling', samples: [], availableMetrics: [] }

// Loads on mount and publishes which activity is live, so a test can wait for
// the load rather than for one of the values it is about to assert on.
function Loader() {
  const { activity, load } = useActivity()
  useEffect(() => {
    load({ type: 'id', id: 'x' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div>activityId:{activity?.id ?? 'none'}</div>
}

async function renderLoaded(activity) {
  const utils = render(
    <AppProviders source={makeSource(activity)}>
      <Loader />
      <Probe />
    </AppProviders>,
  )
  // The restore happens during the same render that first sees the activity,
  // so by the time its id is on screen the remembered view already is too —
  // there is no frame in between showing the defaults.
  await screen.findByText(`activityId:${activity.id}`)
  return utils
}

describe('ChartViewContext per-activity memory', () => {
  it('restores the remembered view when the same activity is loaded again', async () => {
    const user = userEvent.setup()
    const first = await renderLoaded(activityA)

    await user.click(screen.getByText('toggleHrMax'))
    await user.click(screen.getByText('toggleMetricPace'))
    await user.click(screen.getByText('setXMode'))
    first.unmount()

    await renderLoaded(activityA)
    expect(await screen.findByText('xMode:distance')).toBeInTheDocument()
    expect(screen.getByText(`enabledMetrics:${JSON.stringify(metricOrder.filter((m) => m !== 'pace'))}`)).toBeInTheDocument()
    expect(screen.getByText(/"heartRate":\["max"\]/)).toBeInTheDocument()
  })

  it('keeps two activities independent, and does not leak one into the other', async () => {
    const user = userEvent.setup()
    const first = await renderLoaded(activityA)
    await user.click(screen.getByText('toggleHrMax'))
    first.unmount()

    const second = await renderLoaded(activityB)
    expect(await screen.findByText(`enabledStats:${noStats}`)).toBeInTheDocument()
    second.unmount()

    await renderLoaded(activityA)
    expect(await screen.findByText(/"heartRate":\["max"\]/)).toBeInTheDocument()
  })

  it('does not remember the zoom window: a domain in seconds means nothing next time', async () => {
    const user = userEvent.setup()
    const first = await renderLoaded(activityA)
    await user.click(screen.getByText('setZoom'))
    expect(screen.getByText('zoomDomain:[10,20]')).toBeInTheDocument()
    first.unmount()

    await renderLoaded(activityA)
    expect(await screen.findByText('zoomDomain:["dataMin","dataMax"]')).toBeInTheDocument()
    // The view is not remembered either — it is derived from a window that
    // means nothing in the next activity.
    expect(await screen.findByText('viewDomain:["dataMin","dataMax"]')).toBeInTheDocument()
  })

  it('remembers nothing while no activity is loaded, rather than writing a stray entry', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('toggleHrMax'))
    expect(sessionStorage.length).toBe(0)
  })
})
