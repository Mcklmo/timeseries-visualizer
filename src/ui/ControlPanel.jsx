// Composes x-axis mode, metric toggles, and stat checkboxes. See
// ARCHITECTURE.md §3 layer diagram and §11 build order step 6. Reads
// activity.availableMetrics so it never offers a control for a metric the
// loaded activity has no data for.
import { metricOrder } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { MetricToggle } from './MetricToggle.jsx'
import { StatCheckboxes } from './StatCheckboxes.jsx'
import { XAxisModeSwitch } from './XAxisModeSwitch.jsx'

export function ControlPanel() {
  const { activity } = useActivity()

  if (!activity) return null

  const visibleMetrics = metricOrder.filter((id) => activity.availableMetrics.includes(id))

  return (
    <div className="control-panel">
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
  )
}
