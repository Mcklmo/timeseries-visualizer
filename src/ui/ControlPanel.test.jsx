import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { ControlPanel } from './ControlPanel.jsx'
import { ChartStack } from './ChartStack.jsx'
import { AppProviders } from '../app/providers.jsx'
import { useActivity } from '../state/ActivityContext.jsx'
import { metricRegistry, metricOrder, statKinds } from '../metrics/metricRegistry.js'

// Same shape as ChartStack's own fixture, minus `power` — lets tests assert
// that ControlPanel only offers controls for metrics the activity actually
// has, not every metric the registry knows about.
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

const visibleOrder = metricOrder.filter((id) => fixtureActivity.availableMetrics.includes(id))

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

function panelFor(container, metricId) {
  return [...container.querySelectorAll('.metric-panel')].find(
    (p) => p.querySelector('.recharts-line .recharts-curve')?.getAttribute('stroke') === metricRegistry[metricId].color,
  )
}

async function renderApp({ activity = fixtureActivity } = {}) {
  const utils = render(
    <AppProviders source={makeSource(activity)}>
      <Loader />
      <ControlPanel />
      <ChartStack />
    </AppProviders>,
  )
  // Same rAF/layout settle as ChartStack's own tests — ResponsiveContainer
  // commits its measured size in an effect after the initial render.
  await waitFor(() => {
    const panelCount = utils.container.querySelectorAll('.metric-panel').length
    expect(panelCount).toBeGreaterThan(0)
    expect(utils.container.querySelectorAll('.recharts-line .recharts-curve')).toHaveLength(panelCount)
  })
  return utils
}

describe('ControlPanel', () => {
  it('renders nothing before the activity has loaded', () => {
    const { container } = render(
      <AppProviders source={makeSource(fixtureActivity)}>
        <ControlPanel />
      </AppProviders>,
    )
    expect(container.querySelectorAll('input, button')).toHaveLength(0)
  })

  it('offers a metric toggle only for metrics the activity has data for, in canonical order', async () => {
    await renderApp()
    const checkboxes = screen.getAllByRole('checkbox', { name: /^(Pace|Heart rate|Power|Cadence|Elevation)$/ })
    expect(checkboxes.map((c) => c.closest('label').textContent)).toEqual(visibleOrder.map((id) => metricRegistry[id].label))
    expect(screen.queryByRole('checkbox', { name: 'Power' })).not.toBeInTheDocument()
  })

  it('offers a Speed toggle instead of Pace for a cycling activity, even though both are "available"', async () => {
    // Mirrors ChartStack's equivalent test: normalizeActivity flags both
    // pace and speed as available whenever speed data exists; the
    // sport-based pick happens in ControlPanel via isMetricForSport.
    const cycling = { ...fixtureActivity, sport: 'cycling', availableMetrics: ['pace', 'speed', 'heartRate'] }
    await renderApp({ activity: cycling })
    expect(screen.getByRole('checkbox', { name: 'Speed' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Pace' })).not.toBeInTheDocument()
  })

  it('every metric toggle starts checked, matching the default enabledMetrics', async () => {
    await renderApp()
    for (const id of visibleOrder) {
      expect(screen.getByRole('checkbox', { name: metricRegistry[id].label })).toBeChecked()
    }
  })

  it('unchecking a metric toggle removes its panel from the chart stack', async () => {
    const { container } = await renderApp()
    expect(container.querySelectorAll('.metric-panel')).toHaveLength(4)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Cadence' }))

    await waitFor(() => expect(container.querySelectorAll('.metric-panel')).toHaveLength(3))
    expect(panelFor(container, 'cadence')).toBeUndefined()
  })

  it('re-checking a metric toggle restores its panel', async () => {
    const { container } = await renderApp()
    const cadenceToggle = screen.getByRole('checkbox', { name: 'Cadence' })

    await userEvent.click(cadenceToggle)
    await waitFor(() => expect(container.querySelectorAll('.metric-panel')).toHaveLength(3))

    await userEvent.click(cadenceToggle)
    await waitFor(() => expect(container.querySelectorAll('.metric-panel')).toHaveLength(4))
    expect(panelFor(container, 'cadence')).toBeDefined()
  })

  it('starts every stat unchecked, drawing no reference lines until one is asked for', async () => {
    const { container } = await renderApp()
    for (const id of visibleOrder) {
      for (const kind of statKinds) {
        expect(screen.getByRole('checkbox', { name: `${metricRegistry[id].label} ${kind}` })).not.toBeChecked()
      }
      expect(panelFor(container, id).querySelectorAll('.recharts-reference-line')).toHaveLength(0)
    }
  })

  it('checking max adds a reference line to that metric only', async () => {
    const { container } = await renderApp()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Heart rate max' }))

    await waitFor(() => expect(panelFor(container, 'heartRate').querySelectorAll('.recharts-reference-line')).toHaveLength(1))
    expect(panelFor(container, 'cadence').querySelectorAll('.recharts-reference-line')).toHaveLength(0)
  })

  it('checking a second stat on the same metric adds a second reference line', async () => {
    const { container } = await renderApp()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Heart rate max' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Heart rate avg' }))

    await waitFor(() => expect(panelFor(container, 'heartRate').querySelectorAll('.recharts-reference-line')).toHaveLength(2))
  })

  it('unchecking avg removes its reference line again', async () => {
    const { container } = await renderApp()
    const avg = screen.getByRole('checkbox', { name: 'Cadence avg' })

    await userEvent.click(avg)
    await waitFor(() => expect(panelFor(container, 'cadence').querySelectorAll('.recharts-reference-line')).toHaveLength(1))

    await userEvent.click(avg)
    await waitFor(() => expect(panelFor(container, 'cadence').querySelectorAll('.recharts-reference-line')).toHaveLength(0))
  })

  it('defaults the x-axis mode switch to time', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: 'Time' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Distance' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switching to distance re-plots every panel against cumulative distance', async () => {
    const { container } = await renderApp()
    const bottomPanel = () => container.querySelectorAll('.metric-panel')[visibleOrder.length - 1]
    const bottomTickLabels = () =>
      [...bottomPanel().querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value tspan')].map(
        (el) => el.textContent,
      )

    expect(bottomTickLabels().at(-1)).toBe('0:40') // elapsed, matches fixture's last sample t (40s)

    await userEvent.click(screen.getByRole('button', { name: 'Distance' }))

    await waitFor(() => expect(bottomTickLabels().at(-1)).toBe('200m')) // matches fixture's last sample d
    expect(screen.getByRole('button', { name: 'Distance' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Time' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('starts expanded on a wide viewport, so the controls are visible without a click', async () => {
    const { container } = await renderApp()
    expect(container.querySelector('details.control-panel')).toHaveAttribute('open')
  })
})

// setupTests.js stubs matchMedia to matches:false (i.e. "not narrow") because
// that's the branch every assertion above expects. The narrow branch has to
// reassign it — and restore it, or every later file in this run inherits a
// phone-sized viewport.
describe('ControlPanel on a narrow viewport', () => {
  const realMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = realMatchMedia
  })

  function goNarrow() {
    window.matchMedia = (query) => ({
      matches: query.includes('max-width: 720px'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })
  }

  it('starts collapsed, giving the charts the screen instead of five rows of chrome', async () => {
    goNarrow()
    const { container } = await renderApp()
    expect(container.querySelector('details.control-panel')).not.toHaveAttribute('open')
  })

  // Asserted on the attribute above rather than on a role query going absent,
  // because jsdom 30 does not apply the UA rule that hides a closed <details>'s
  // contents — every control stays queryable here even while collapsed. In a
  // real browser they are genuinely hidden; that difference is only observable
  // in one, so don't write a test that claims otherwise.
  it('still renders the controls in the DOM while collapsed (jsdom applies no <details> hiding)', async () => {
    goNarrow()
    await renderApp()
    expect(screen.getByRole('checkbox', { name: 'Cadence' })).toBeInTheDocument()
  })

  it('opens on the summary, restoring every control', async () => {
    goNarrow()
    await renderApp()

    await userEvent.click(screen.getByText('Chart settings'))

    for (const id of visibleOrder) {
      expect(screen.getByRole('checkbox', { name: metricRegistry[id].label })).toBeInTheDocument()
    }
  })
})
