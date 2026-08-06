import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivitySourceProvider, useActivitySource } from './ActivitySource.js'

function Probe() {
  const source = useActivitySource()
  return <div>kind:{source.kind}</div>
}

describe('ActivitySourceProvider / useActivitySource', () => {
  it('publishes the injected source instance on context', () => {
    render(
      <ActivitySourceProvider source={{ kind: 'mock', load: () => Promise.resolve() }}>
        <Probe />
      </ActivitySourceProvider>,
    )
    expect(screen.getByText('kind:mock')).toBeInTheDocument()
  })

  it('throws a clear error when used outside a provider (catches a wiring mistake early)', () => {
    // Suppress the expected React error-boundary console noise for this one assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ActivitySourceProvider/)
    spy.mockRestore()
  })
})
