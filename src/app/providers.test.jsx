import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppProviders } from './providers.jsx'
import { useActivitySource } from '../data/ActivitySource.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { useStatsBasis } from '../stats/StatsBasisContext.jsx'

function Probe() {
  const source = useActivitySource()
  const { status } = useActivity()
  const { xMode } = useChartView()
  // Reading the innermost provider at all is the assertion: it derives its
  // window from the two above it, so it can only resolve if the nesting order
  // held.
  const { xKey } = useStatsBasis()
  return (
    <div>
      source:{source.kind} status:{status} xMode:{xMode} xKey:{xKey}
    </div>
  )
}

describe('AppProviders', () => {
  it('wires ActivitySource, Activity, ChartView and StatsBasis contexts together from one composed source prop', () => {
    render(
      <AppProviders source={{ kind: 'mock', load: () => Promise.resolve() }}>
        <Probe />
      </AppProviders>,
    )
    expect(screen.getByText('source:mock status:idle xMode:time xKey:t')).toBeInTheDocument()
  })
})
