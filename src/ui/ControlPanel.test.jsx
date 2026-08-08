import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { ControlPanel } from './ControlPanel.jsx'
import { ChartStack } from './ChartStack.jsx'
import { AppProviders } from '../app/providers.jsx'
import { useActivity } from '../state/ActivityContext.jsx'
import { metricRegistry, metricOrder, statKindsFor } from '../metrics/metricRegistry.js'
import { statCheckboxLabel } from './StatCheckboxes.jsx'

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
    (p) => p.querySelector('.metric-line .recharts-curve')?.getAttribute('stroke') === metricRegistry[metricId].color,
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
      // statKindsFor, not the global statKinds: `pace` and `cadence` declare no
      // derivative and so render four boxes where `heartRate` and `altitude`
      // render six. Names come from StatCheckboxes' own helper, since the
      // derivative boxes are labelled from the registry's prose ("Heart rate
      // ramp"), not from the kind id.
      for (const kind of statKindsFor(metricRegistry[id])) {
        expect(screen.getByRole('checkbox', { name: statCheckboxLabel(metricRegistry[id], kind) })).not.toBeChecked()
      }
      expect(panelFor(container, id).querySelectorAll('.recharts-reference-line')).toHaveLength(0)
    }
  })

  it('offers derivative boxes only on metrics that declare one', async () => {
    await renderApp()
    // heartRate and altitude have a `derivative` spec; pace and cadence do not.
    expect(screen.getAllByRole('checkbox', { name: /^Heart rate / })).toHaveLength(6)
    expect(screen.getAllByRole('checkbox', { name: /^Elevation / })).toHaveLength(6)
    expect(screen.getAllByRole('checkbox', { name: /^Pace / })).toHaveLength(4)
    expect(screen.getAllByRole('checkbox', { name: /^Cadence / })).toHaveLength(4)
  })

  it('checking one derivative clears the other on that metric, but leaves scalar stats alone', async () => {
    // One right-hand axis carries one unit — see ChartViewContext's toggleStat.
    await renderApp()
    const ramp = screen.getByRole('checkbox', { name: 'Heart rate ramp' })
    const rampAccel = screen.getByRole('checkbox', { name: 'Heart rate ramp accel' })
    const max = screen.getByRole('checkbox', { name: 'Heart rate max' })

    await userEvent.click(max)
    await userEvent.click(ramp)
    await waitFor(() => expect(ramp).toBeChecked())

    await userEvent.click(rampAccel)
    await waitFor(() => expect(rampAccel).toBeChecked())
    expect(ramp).not.toBeChecked()
    // The scalar stat is untouched by the exclusion: it is on its own axis.
    expect(max).toBeChecked()

    // And the exclusion is not a one-way trap — d/dt clears d²/dt² too.
    await userEvent.click(ramp)
    await waitFor(() => expect(ramp).toBeChecked())
    expect(rampAccel).not.toBeChecked()
  })

  it('draws the derivative overlay on that panel only', async () => {
    const { container } = await renderApp()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Heart rate ramp' }))

    await waitFor(() => expect(panelFor(container, 'heartRate').querySelector('.deriv-line')).not.toBeNull())
    expect(panelFor(container, 'cadence').querySelector('.deriv-line')).toBeNull()
    // A derivative draws no chip and no horizontal reference line except the
    // zero crossing — it is a series, not a scalar (§2.2/§2.6).
    expect(panelFor(container, 'heartRate').querySelectorAll('.stat-chip')).toHaveLength(0)
    expect(panelFor(container, 'heartRate').querySelectorAll('.recharts-reference-line')).toHaveLength(1)
  })

  it('lights a checked derivative box in the colour of the line it draws, and leaves the scalar boxes dim', async () => {
    // The tint means "derived", not "checked", so the control and the mark it
    // draws read as one thing.
    const { container } = await renderApp()
    const ramp = screen.getByRole('checkbox', { name: 'Heart rate ramp' })
    const max = screen.getByRole('checkbox', { name: 'Heart rate max' })

    expect(ramp.closest('.stat-checkbox')).not.toHaveClass('stat-checkbox--active')

    await userEvent.click(ramp)
    await waitFor(() => expect(ramp.closest('.stat-checkbox')).toHaveClass('stat-checkbox--active'))

    await userEvent.click(max)
    await waitFor(() => expect(max).toBeChecked())
    expect(max.closest('.stat-checkbox')).not.toHaveClass('stat-checkbox--active')

    // The control and the mark are one thing only if they are literally one
    // colour. They were not: the box lit `--accent` cyan while the line drew a
    // lighter step of the metric's own hue — pale pink, for heart rate.
    const drawn = panelFor(container, 'heartRate').querySelector('.deriv-line .recharts-curve').getAttribute('stroke')
    expect(ramp.closest('.stat-checkbox').style.getPropertyValue('--deriv-hue')).toBe(drawn)
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
