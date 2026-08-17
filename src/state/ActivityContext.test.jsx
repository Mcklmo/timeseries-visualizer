import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivitySourceProvider } from '../data/ActivitySource.js'
import { ActivityProvider, useActivity } from './ActivityContext.jsx'

function Probe() {
  const { activity, ref, status, error, load } = useActivity()
  return (
    <div>
      <div>status:{status}</div>
      <div>activity:{activity ? activity.id : 'none'}</div>
      <div>ref:{ref ? ref.id : 'none'}</div>
      <div>error:{error ? error.message : 'none'}</div>
      <button onClick={() => load({ type: 'id', id: 'anything' })}>load</button>
    </div>
  )
}

function renderProbe(source) {
  render(
    <ActivitySourceProvider source={source}>
      <ActivityProvider>
        <Probe />
      </ActivityProvider>
    </ActivitySourceProvider>,
  )
}

describe('ActivityContext', () => {
  it('starts idle with no activity and no error', () => {
    renderProbe({ kind: 'mock', load: () => Promise.resolve() })
    expect(screen.getByText('status:idle')).toBeInTheDocument()
    expect(screen.getByText('activity:none')).toBeInTheDocument()
    expect(screen.getByText('ref:none')).toBeInTheDocument()
    expect(screen.getByText('error:none')).toBeInTheDocument()
  })

  it('goes loading -> ready and publishes the resolved activity', async () => {
    const user = userEvent.setup()
    renderProbe({ kind: 'mock', load: () => Promise.resolve({ id: 'run-1' }) })

    await user.click(screen.getByText('load'))

    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument())
    expect(screen.getByText('activity:run-1')).toBeInTheDocument()
    expect(screen.getByText('error:none')).toBeInTheDocument()
  })

  it('goes loading -> error and publishes the rejection, clearing any prior activity', async () => {
    const user = userEvent.setup()
    const boom = new Error('boom')
    renderProbe({ kind: 'mock', load: () => Promise.reject(boom) })

    await user.click(screen.getByText('load'))

    await waitFor(() => expect(screen.getByText('status:error')).toBeInTheDocument())
    expect(screen.getByText('activity:none')).toBeInTheDocument()
    expect(screen.getByText('ref:none')).toBeInTheDocument()
    expect(screen.getByText('error:boom')).toBeInTheDocument()
  })

  it('publishes the ref that produced the activity, so consumers can tell a dropped file from a sync', async () => {
    const user = userEvent.setup()
    renderProbe({ kind: 'mock', load: () => Promise.resolve({ id: 'run-1' }) })

    await user.click(screen.getByText('load'))

    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument())
    expect(screen.getByText('ref:anything')).toBeInTheDocument()
  })

  it('calls the injected source.load with the given ref', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockResolvedValue({ id: 'run-1' })
    renderProbe({ kind: 'mock', load })

    await user.click(screen.getByText('load'))

    await waitFor(() => expect(load).toHaveBeenCalledWith({ type: 'id', id: 'anything' }))
  })

  it('throws a clear error when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ActivityProvider/)
    spy.mockRestore()
  })
})
