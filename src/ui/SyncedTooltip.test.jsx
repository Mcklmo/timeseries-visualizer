import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SyncedTooltip } from './SyncedTooltip.jsx'
import { metricRegistry } from '../metrics/metricRegistry.js'

const point = { t: 125, d: 430, heartRate: 152 }
const payload = [{ value: 152, dataKey: 'heartRate', payload: point }]

describe('SyncedTooltip', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<SyncedTooltip active={false} payload={payload} metric={metricRegistry.heartRate} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is no payload', () => {
    const { container } = render(<SyncedTooltip active={true} payload={[]} metric={metricRegistry.heartRate} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows both elapsed time and distance in the header, regardless of x-axis mode', () => {
    const { getByText } = render(<SyncedTooltip active={true} payload={payload} metric={metricRegistry.heartRate} />)
    expect(getByText('2:05', { exact: false })).toBeInTheDocument()
    expect(getByText('0.43 km', { exact: false })).toBeInTheDocument()
  })

  it('shows the metric label, formatted value, and unit', () => {
    const { getByText } = render(<SyncedTooltip active={true} payload={payload} metric={metricRegistry.heartRate} />)
    expect(getByText('Heart rate: 152 bpm', { exact: false })).toBeInTheDocument()
  })

  it('formats the value through the metric-specific formatter (pace mm:ss)', () => {
    const pacePoint = { t: 0, d: 0, pace: 287 }
    const pacePayload = [{ value: 287, dataKey: 'pace', payload: pacePoint }]
    const { getByText } = render(<SyncedTooltip active={true} payload={pacePayload} metric={metricRegistry.pace} />)
    expect(getByText('Pace: 4:47 min/km', { exact: false })).toBeInTheDocument()
  })

  it('shows a dash when the value is null (sensor dropout)', () => {
    const gapPoint = { t: 10, d: 20, heartRate: null }
    const gapPayload = [{ value: null, dataKey: 'heartRate', payload: gapPoint }]
    const { getByText } = render(<SyncedTooltip active={true} payload={gapPayload} metric={metricRegistry.heartRate} />)
    expect(getByText('Heart rate: – bpm', { exact: false })).toBeInTheDocument()
  })

  it("resolves cadence's unit from the sport prop: spm for running, rpm for cycling", () => {
    const cadencePoint = { t: 0, d: 0, cadence: 90 }
    const cadencePayload = [{ value: 90, dataKey: 'cadence', payload: cadencePoint }]
    const { getByText: getRunning } = render(
      <SyncedTooltip active={true} payload={cadencePayload} metric={metricRegistry.cadence} sport="running" />,
    )
    expect(getRunning('Cadence: 90 spm', { exact: false })).toBeInTheDocument()

    const { getByText: getCycling } = render(
      <SyncedTooltip active={true} payload={cadencePayload} metric={metricRegistry.cadence} sport="cycling" />,
    )
    expect(getCycling('Cadence: 90 rpm', { exact: false })).toBeInTheDocument()
  })
})
