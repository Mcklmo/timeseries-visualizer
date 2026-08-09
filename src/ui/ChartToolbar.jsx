// The two controls that were never per-graph, in one slim always-visible row
// above the stack. It used to hold the shared position readout's slot as well;
// that moved to ActivityHeader, since this row scrolls away with <main> and the
// app header does not.
//
// This is what survived `ControlPanel`, the single settings window that used to
// hold every chart control at once. The per-metric stat checkboxes moved into
// each panel's own head (MetricPanel's PanelHead), where the graph they act on
// is the thing next to them; x-axis mode and metric show/hide have no single
// graph to belong to, so they stayed here. No <details> and no useIsNarrow with
// them: one row is not worth collapsing, and the ~200px of chrome that made the
// old panel start closed on a phone is exactly what left.
//
// Reads `activity.availableMetrics` directly, so it never offers a control for
// a metric the loaded activity has no data for — mirrors the filter ChartStack
// applies. See ARCHITECTURE.md §7.
import { isMetricForSport, metricOrder } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { MetricToggle } from './MetricToggle.jsx'
import { XAxisModeSwitch } from './XAxisModeSwitch.jsx'

export function ChartToolbar() {
  const { activity } = useActivity()
  // Hoisted above the guard — a hook is a hook wherever its value comes from.
  const { showMap, toggleMap } = useChartView()

  if (!activity) return null

  // AVAILABLE ∧ SPORT, deliberately not the enabled subset: a metric whose
  // panel is switched off has no head of its own, so this row is the only way
  // back to it.
  const visibleMetrics = metricOrder.filter(
    (id) => activity.availableMetrics.includes(id) && isMetricForSport(id, activity.sport),
  )

  return (
    <div className="chart-toolbar">
      <XAxisModeSwitch />
      <ul className="metric-controls">
        {/* The map rides in this row for exactly the reason the comment above
            gives for listing available-∧-sport rather than the enabled subset:
            a hidden panel has no head of its own, so this is the only way back
            to it. It is gated on `activity.track != null` — the feature's whole
            availability rule — and NOT on an entry in availableMetrics, which
            is hashed into the activity's id (domain/activityKey.js). It is
            therefore a plain checkbox rather than a <MetricToggle>: there is no
            registry entry behind it and there must not be one. */}
        {activity.track != null && (
          <li>
            <label className="metric-toggle metric-toggle--map">
              <input type="checkbox" checked={showMap} onChange={toggleMap} />
              Route
            </label>
          </li>
        )}
        {visibleMetrics.map((id) => (
          <li key={id}>
            <MetricToggle metricId={id} />
          </li>
        ))}
      </ul>
    </div>
  )
}
