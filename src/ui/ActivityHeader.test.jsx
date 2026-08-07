import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { ActivityHeader } from './ActivityHeader.jsx'
import { AppProviders } from '../app/providers.jsx'
import { useActivity } from '../state/ActivityContext.jsx'

const fixtureActivity = {
  id: 'a1',
  sport: 'running',
  name: 'Morning Run',
  totalMovingTime: 40,
  totalDistance: 200,
  samples: [],
  availableMetrics: [],
}

function makeSource(activity) {
  return { kind: 'mock', load: () => Promise.resolve(activity) }
}

function Loader() {
  const { load } = useActivity()
  useEffect(() => {
    load({ type: 'id', id: 'x' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

describe('ActivityHeader', () => {
  it('renders nothing before the activity has loaded', () => {
    const { container } = render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <ActivityHeader />
      </AppProviders>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the inferred name and a "Running" chip for a running activity', async () => {
    render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('Morning Run')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders a "Cycling" chip for a cycling activity', async () => {
    const cycling = { ...fixtureActivity, sport: 'cycling', name: 'Evening Ride' }
    render(
      <AppProviders source={makeSource(cycling)}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('Evening Ride')).toBeInTheDocument()
    expect(screen.getByText('Cycling')).toBeInTheDocument()
  })

  it('renders a "Track" chip for a GPS-only track', async () => {
    const track = { ...fixtureActivity, sport: 'track', name: '3-day Track' }
    render(
      <AppProviders source={makeSource(track)}>
        <Loader />
        <ActivityHeader />
      </AppProviders>,
    )
    expect(await screen.findByText('3-day Track')).toBeInTheDocument()
    expect(screen.getByText('Track')).toBeInTheDocument()
  })
})
