// The two controls that were never per-graph, in one slim always-visible row
// above the stack — plus the slot the shared position readout portals into.
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
import { MetricToggle } from './MetricToggle.jsx'
import { XAxisModeSwitch } from './XAxisModeSwitch.jsx'

/**
 * @param {object} props
 * @param {(node: Element|null) => void} [props.positionRef] - callback ref for
 *   the shared `12:05 · 2.34 km` slot, owned by ChartStack and filled by the
 *   first visible panel's CrosshairReadout.
 */
export function ChartToolbar({ positionRef }) {
  const { activity } = useActivity()

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
        {visibleMetrics.map((id) => (
          <li key={id}>
            <MetricToggle metricId={id} />
          </li>
        ))}
      </ul>
      {/* Portal target, never given React children — see MetricPanel's slot for
          the same rule and why. Empty at rest on purpose: transient chrome stays
          out of an idle screenshot (§9). */}
      <span className="crosshair-position" ref={positionRef} />
    </div>
  )
}
