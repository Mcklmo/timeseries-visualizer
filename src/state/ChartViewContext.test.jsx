import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChartViewProvider, useChartView } from './ChartViewContext.jsx'
import { metricOrder } from '../metrics/metricRegistry.js'

function Probe() {
  const view = useChartView()
  return (
    <div>
      <div>xMode:{view.xMode}</div>
      <div>zoomDomain:{JSON.stringify(view.zoomDomain)}</div>
      <div>enabledMetrics:{JSON.stringify(view.enabledMetrics)}</div>
      <div>enabledStats:{JSON.stringify(view.enabledStats)}</div>
      <div>hoverIndex:{JSON.stringify(view.hoverIndex)}</div>
      <button onClick={() => view.setXMode('distance')}>setXMode</button>
      <button onClick={() => view.setZoomDomain([10, 20])}>setZoomDomain</button>
      <button onClick={() => view.toggleMetric('pace')}>toggleMetricPace</button>
      <button onClick={() => view.toggleStat('heartRate', 'max')}>toggleHrMax</button>
      <button onClick={() => view.toggleStat('pace', 'avg')}>togglePaceAvg</button>
      <button onClick={() => view.setHoverIndex(7)}>setHoverIndex</button>
    </div>
  )
}

function renderProbe() {
  render(
    <ChartViewProvider>
      <Probe />
    </ChartViewProvider>,
  )
}

describe('ChartViewContext', () => {
  it('defaults to time mode, full zoom domain, and every metric enabled', () => {
    renderProbe()
    expect(screen.getByText('xMode:time')).toBeInTheDocument()
    expect(screen.getByText('zoomDomain:["dataMin","dataMax"]')).toBeInTheDocument()
    expect(screen.getByText(`enabledMetrics:${JSON.stringify(metricOrder)}`)).toBeInTheDocument()
    expect(screen.getByText('hoverIndex:null')).toBeInTheDocument()
  })

  it('setXMode switches between time and distance', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setXMode'))
    expect(screen.getByText('xMode:distance')).toBeInTheDocument()
  })

  it('setZoomDomain replaces the controlled domain wholesale', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setZoomDomain'))
    expect(screen.getByText('zoomDomain:[10,20]')).toBeInTheDocument()
  })

  it('setXMode resets zoomDomain to the full range', async () => {
    // A numeric zoomDomain from one mode (e.g. seconds) is meaningless in
    // the other (metres) — carrying it across would silently misclip the
    // axis, so switching modes resets zoom instead.
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setZoomDomain'))
    expect(screen.getByText('zoomDomain:[10,20]')).toBeInTheDocument()
    await user.click(screen.getByText('setXMode'))
    expect(screen.getByText('zoomDomain:["dataMin","dataMax"]')).toBeInTheDocument()
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
    expect(screen.getByText('enabledStats:{"pace":["avg"],"heartRate":["avg","max"],"power":["avg"],"cadence":["avg"],"altitude":["avg"]}')).toBeInTheDocument()
  })

  it('toggleStat removes a stat that is already enabled', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('togglePaceAvg'))
    expect(screen.getByText('enabledStats:{"pace":[],"heartRate":["avg"],"power":["avg"],"cadence":["avg"],"altitude":["avg"]}')).toBeInTheDocument()
  })

  it('setHoverIndex publishes the hovered sample index', async () => {
    const user = userEvent.setup()
    renderProbe()
    await user.click(screen.getByText('setHoverIndex'))
    expect(screen.getByText('hoverIndex:7')).toBeInTheDocument()
  })

  it('throws a clear error when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ChartViewProvider/)
    spy.mockRestore()
  })
})
