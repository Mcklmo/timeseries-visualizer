// Ported from SyncedTooltip.test.jsx, which covered the same selection logic
// when the readout was still a box that followed the cursor. Everything about
// *which* payload entry is read is unchanged and still load-bearing; what
// changed is where the text lands — a slot node the component portals into,
// rather than its own return value. So every assertion reads the slot's
// textContent, and the component's own container is expected to stay empty.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CrosshairReadout } from './CrosshairReadout.jsx'
import { metricRegistry } from '../metrics/metricRegistry.js'

const point = { t: 125, d: 430, heartRate: 152 }
const payload = [{ value: 152, dataKey: 'heartRate', payload: point }]

/** A slot node outside the React tree, exactly as the panel head provides one. */
function makeSlot() {
  const slot = document.createElement('span')
  document.body.appendChild(slot)
  return slot
}

/** Renders the bridge against a fresh value slot and hands back the slot. */
function renderReadout(props = {}) {
  const valueSlot = props.valueSlot === undefined ? makeSlot() : props.valueSlot
  const utils = render(<CrosshairReadout active={true} payload={payload} {...props} valueSlot={valueSlot} />)
  return { ...utils, valueSlot }
}

describe('CrosshairReadout', () => {
  it('portals nothing when inactive', () => {
    const { valueSlot, container } = renderReadout({ active: false, metric: metricRegistry.heartRate })
    expect(valueSlot).toBeEmptyDOMElement()
    expect(container).toBeEmptyDOMElement()
  })

  it('portals nothing when there is no payload', () => {
    const { valueSlot } = renderReadout({ payload: [], metric: metricRegistry.heartRate })
    expect(valueSlot).toBeEmptyDOMElement()
  })

  it('renders into the slot, not into its own subtree — the label must not follow the cursor', () => {
    const { valueSlot, container } = renderReadout({ metric: metricRegistry.heartRate })
    expect(valueSlot.textContent).toContain('152 bpm')
    expect(container).toBeEmptyDOMElement()
  })

  // The metric's NAME is static text in the panel head, next to this slot, so
  // it is deliberately absent from the readout — the one behavioural difference
  // from the tooltip this replaced ("Heart rate: 152 bpm" → "152 bpm").
  it('shows the formatted value and unit, without repeating the metric’s name', () => {
    const { valueSlot } = renderReadout({ metric: metricRegistry.heartRate })
    expect(valueSlot.textContent).toContain('152 bpm')
    expect(valueSlot.textContent).not.toContain('Heart rate')
  })

  it('formats the value through the metric-specific formatter (pace mm:ss)', () => {
    const pacePoint = { t: 0, d: 0, pace: 287 }
    const { valueSlot } = renderReadout({
      payload: [{ value: 287, dataKey: 'pace', payload: pacePoint }],
      metric: metricRegistry.pace,
    })
    expect(valueSlot.textContent).toContain('4:47 min/km')
  })

  it('shows a dash when the value is null (sensor dropout)', () => {
    const gapPoint = { t: 10, d: 20, heartRate: null }
    const { valueSlot } = renderReadout({
      payload: [{ value: null, dataKey: 'heartRate', payload: gapPoint }],
      metric: metricRegistry.heartRate,
    })
    expect(valueSlot.textContent).toContain('– bpm')
  })

  it("resolves cadence's unit from the sport prop: spm for running, rpm for cycling", () => {
    const cadencePayload = [{ value: 90, dataKey: 'cadence', payload: { t: 0, d: 0, cadence: 90 } }]
    const running = renderReadout({ payload: cadencePayload, metric: metricRegistry.cadence, sport: 'running' })
    expect(running.valueSlot.textContent).toContain('90 spm')

    const cycling = renderReadout({ payload: cadencePayload, metric: metricRegistry.cadence, sport: 'cycling' })
    expect(cycling.valueSlot.textContent).toContain('90 rpm')
  })

  // With a derivative overlay a panel draws TWO <Line>s, so the payload holds
  // two entries in an order Recharts does not specify. Reading payload[0] — as
  // the original component used to — showed the rate under the metric's own
  // unit whenever the order came back the other way.
  describe('with a derivative overlay in the payload', () => {
    const derivative = { key: 'heartRate:d', spec: metricRegistry.heartRate.derivative.d1 }
    const derivPoint = { t: 125, d: 430, heartRate: 152, 'heartRate:d': 4.2 }
    const entries = {
      metric: { value: 152, dataKey: 'heartRate', payload: derivPoint },
      deriv: { value: 4.2, dataKey: 'heartRate:d', payload: derivPoint },
    }

    it('reads the metric off its own dataKey whichever order the payload arrives in', () => {
      for (const payloadOrder of [
        [entries.metric, entries.deriv],
        [entries.deriv, entries.metric],
      ]) {
        const { valueSlot } = renderReadout({ payload: payloadOrder, metric: metricRegistry.heartRate })
        expect(valueSlot.textContent).toContain('152 bpm')
      }
    })

    it('adds the rate beside it, in the derivative’s own units', () => {
      const { valueSlot } = renderReadout({
        payload: [entries.deriv, entries.metric],
        metric: metricRegistry.heartRate,
        derivative,
      })
      expect(valueSlot.textContent).toContain('152 bpm')
      expect(valueSlot.textContent).toContain('ramp +4.2 bpm/min')
    })

    it('shows no rate when no overlay is on, even if the row still carries the key', () => {
      const { valueSlot } = renderReadout({ payload: [entries.metric], metric: metricRegistry.heartRate })
      expect(valueSlot.textContent).not.toContain('ramp')
    })

    it('dashes the rate across a dropout rather than reading a null as zero', () => {
      const gap = { value: null, dataKey: 'heartRate:d', payload: { t: 1, d: 2, heartRate: 152 } }
      const { valueSlot } = renderReadout({
        payload: [entries.metric, gap],
        metric: metricRegistry.heartRate,
        derivative,
      })
      expect(valueSlot.textContent).toContain('ramp – bpm/min')
    })
  })

  describe('the shared position slot', () => {
    it('reports both elapsed time and distance, regardless of x-axis mode', () => {
      const positionSlot = makeSlot()
      renderReadout({ metric: metricRegistry.heartRate, positionSlot })
      expect(positionSlot.textContent).toContain('2:05')
      expect(positionSlot.textContent).toContain('0.43 km')
    })

    // Every panel but the first is handed null, since all of them are synced to
    // the same sample and the readout is shared.
    it('portals nothing anywhere when no position slot is given', () => {
      const { valueSlot } = renderReadout({ metric: metricRegistry.heartRate, positionSlot: null })
      expect(valueSlot.textContent).toContain('152 bpm')
      expect(valueSlot.textContent).not.toContain('2:05')
    })

    it('still fills the position slot when only the derivative entry carries the row', () => {
      // A hover can land where the metric itself is null; the position comes off
      // whichever entry is present, since both carry the same row.
      const positionSlot = makeSlot()
      const derivOnly = { value: 4.2, dataKey: 'heartRate:d', payload: { t: 125, d: 430 } }
      renderReadout({
        payload: [derivOnly],
        metric: metricRegistry.heartRate,
        derivative: { key: 'heartRate:d', spec: metricRegistry.heartRate.derivative.d1 },
        positionSlot,
      })
      expect(positionSlot.textContent).toContain('2:05')
    })
  })
})
