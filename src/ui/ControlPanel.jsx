// Composes x-axis mode, metric toggles, and stat checkboxes. See
// ARCHITECTURE.md §3 layer diagram and §11 build order step 6. Reads
// activity.availableMetrics so it never offers a control for a metric the
// loaded activity has no data for.
import { isMetricForSport, metricOrder } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { MetricToggle } from './MetricToggle.jsx'
import { StatCheckboxes } from './StatCheckboxes.jsx'
import { useIsNarrow } from './useIsNarrow.js'
import { XAxisModeSwitch } from './XAxisModeSwitch.jsx'

export function ControlPanel() {
  const { activity } = useActivity()
  // Five stacked metric rows is ~200px of chrome above the first chart on a
  // phone — the charts are what the screen is for, so it starts collapsed
  // there. This has to come from JS: a <details>'s open state is a DOM
  // attribute, and no media query can set one. Only the *initial* value is
  // ours; after that the element owns its own state, so opening the panel on
  // a phone sticks rather than being slammed shut on the next render.
  const isNarrow = useIsNarrow()

  if (!activity) return null

  const visibleMetrics = metricOrder.filter(
    (id) => activity.availableMetrics.includes(id) && isMetricForSport(id, activity.sport),
  )

  return (
    <details className="control-panel" open={!isNarrow}>
      <summary className="control-panel__summary">Chart settings</summary>
      {/* The flex column lives on this wrapper, not on the <details> itself:
          overriding a <details>'s own `display` is what historically broke the
          closed state's content hiding in WebKit, and iOS Safari is exactly
          the browser this collapse exists for. */}
      <div className="control-panel__body">
        <XAxisModeSwitch />
        <ul className="metric-controls">
          {visibleMetrics.map((id) => (
            <li key={id} className="metric-control-row">
              <MetricToggle metricId={id} />
              <StatCheckboxes metricId={id} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
