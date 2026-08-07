import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App, { AppShell } from './App.jsx'
import { AppProviders } from './app/providers.jsx'

function makeFile(name = 'run.tcx') {
  return new File(['<xml/>'], name, { type: 'application/vnd.garmin.tcx+xml' })
}

// Small hand-built fixture (same shape as ControlPanel.test.jsx's) for the
// tests below that need control over the ActivitySource itself (loading /
// error timing) — the real App wiring is exercised separately against the
// actual MockActivitySource, which always resolves fixtures/sample-run.json.
const fixtureActivity = {
  id: 'a1',
  sport: 'running',
  totalMovingTime: 40,
  totalDistance: 200,
  samples: [
    { t: 0, d: 0, speed: 4, heartRate: 120, cadence: 170, altitude: 10, moving: true },
    { t: 10, d: 50, speed: 5, heartRate: 130, cadence: 172, altitude: 12, moving: true },
    { t: 20, d: 100, speed: 6, heartRate: 150, cadence: 174, altitude: 14, moving: true },
    { t: 30, d: 150, speed: 5, heartRate: 140, cadence: 176, altitude: 16, moving: true },
    { t: 40, d: 200, speed: 3, heartRate: 110, cadence: 178, altitude: 18, moving: true },
  ],
  availableMetrics: ['pace', 'heartRate', 'cadence', 'altitude'],
}

describe('App (wired against the real MockActivitySource)', () => {
  it('shows the empty state before any activity is loaded', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /activity visualiser/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sample activity/i })).toBeInTheDocument()
  })

  it('loads the sample activity end-to-end into synced, controllable chart panels', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: /sample activity/i }))

    await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))
    expect(screen.getByRole('checkbox', { name: 'Pace' })).toBeChecked()
    expect(screen.queryByRole('button', { name: /sample activity/i })).not.toBeInTheDocument()
  })

  it('loads via the file drop zone too, since the wired source resolves the same fixture regardless of ref', async () => {
    const { container } = render(<App />)

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [makeFile()] },
    })

    await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))
  })
})

describe('AppShell (controlled source, for states the real Mock never produces)', () => {
  function renderShell(source) {
    return render(
      <AppProviders source={source}>
        <AppShell />
      </AppProviders>,
    )
  }

  it('shows a loading indicator between requesting and resolving an activity', async () => {
    const user = userEvent.setup()
    let resolveLoad
    const load = () => new Promise((resolve) => (resolveLoad = resolve))
    renderShell({ kind: 'mock', load })

    await user.click(screen.getByRole('button', { name: /sample activity/i }))
    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    resolveLoad(fixtureActivity)
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument())
  })

  it('shows an error state when the source rejects, without leaving stale loading/empty UI behind', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockRejectedValue(new Error('unsupported TCX schema'))
    renderShell({ kind: 'mock', load })

    await user.click(screen.getByRole('button', { name: /sample activity/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/unsupported tcx schema/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
  })

  it('retries the same load on demand from the error state', async () => {
    const user = userEvent.setup()
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('unsupported TCX schema'))
      .mockResolvedValueOnce(fixtureActivity)
    const { container } = renderShell({ kind: 'mock', load })

    await user.click(screen.getByRole('button', { name: /sample activity/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(container.querySelectorAll('.metric-panel').length).toBeGreaterThan(0))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
