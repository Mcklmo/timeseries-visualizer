import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppProviders } from './providers.jsx'
import { useActivitySource } from '../data/ActivitySource.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'

function Probe() {
  const source = useActivitySource()
  const { status } = useActivity()
  const { xMode } = useChartView()
  return (
    <div>
      source:{source.kind} status:{status} xMode:{xMode}
    </div>
  )
}

describe('AppProviders', () => {
  it('wires ActivitySource, Activity, and ChartView contexts together from one composed source prop', () => {
    render(
      <AppProviders source={{ kind: 'mock', load: () => Promise.resolve() }}>
        <Probe />
      </AppProviders>,
    )
    expect(screen.getByText('source:mock status:idle xMode:time')).toBeInTheDocument()
  })
})
