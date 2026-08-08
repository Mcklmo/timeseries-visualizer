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

  // With a derivative overlay a panel draws TWO <Line>s, so the payload holds
  // two entries in an order Recharts does not specify. Reading payload[0] — as
  // this component used to — showed the rate under the metric's own name and
  // unit whenever the order came back the other way.
  describe('with a derivative overlay in the payload', () => {
    const derivative = { key: 'heartRate:d', spec: metricRegistry.heartRate.derivative.d1 }
    const derivPoint = { t: 125, d: 430, heartRate: 152, 'heartRate:d': 4.2 }
    const entries = {
      metric: { value: 152, dataKey: 'heartRate', payload: derivPoint },
      deriv: { value: 4.2, dataKey: 'heartRate:d', payload: derivPoint },
    }

    it('reads the metric off its own dataKey whichever order the payload arrives in', () => {
      // Both orders render into the same document here, so assert on each
      // container's own text rather than a document-wide query.
      for (const payloadOrder of [
        [entries.metric, entries.deriv],
        [entries.deriv, entries.metric],
      ]) {
        const { container } = render(
          <SyncedTooltip active={true} payload={payloadOrder} metric={metricRegistry.heartRate} />,
        )
        expect(container.textContent).toContain('Heart rate: 152 bpm')
      }
    })

    it('adds a second row for the rate, in the derivative’s own units', () => {
      const { getByText } = render(
        <SyncedTooltip
          active={true}
          payload={[entries.deriv, entries.metric]}
          metric={metricRegistry.heartRate}
          derivative={derivative}
        />,
      )
      expect(getByText('Heart rate: 152 bpm', { exact: false })).toBeInTheDocument()
      expect(getByText('ramp: +4.2 bpm/min', { exact: false })).toBeInTheDocument()
    })

    it('shows no rate row when no overlay is on, even if the row still carries the key', () => {
      const { queryByText } = render(
        <SyncedTooltip active={true} payload={[entries.metric]} metric={metricRegistry.heartRate} />,
      )
      expect(queryByText('ramp:', { exact: false })).not.toBeInTheDocument()
    })

    it('dashes the rate across a dropout rather than reading a null as zero', () => {
      const gap = { value: null, dataKey: 'heartRate:d', payload: { t: 1, d: 2, heartRate: 152 } }
      const { getByText } = render(
        <SyncedTooltip
          active={true}
          payload={[entries.metric, gap]}
          metric={metricRegistry.heartRate}
          derivative={derivative}
        />,
      )
      expect(getByText('ramp: – bpm/min', { exact: false })).toBeInTheDocument()
    })
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
