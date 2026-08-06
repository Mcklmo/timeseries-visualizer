// Checkbox that shows/hides one metric's panel across the whole ChartStack.
// See ARCHITECTURE.md §10 — writes ChartViewContext's enabledMetrics.
import { metricRegistry } from '../metrics/metricRegistry.js'
import { useChartView } from '../state/ChartViewContext.jsx'

export function MetricToggle({ metricId }) {
  const metric = metricRegistry[metricId]
  const { enabledMetrics, toggleMetric } = useChartView()

  return (
    <label className="metric-toggle" style={{ '--metric-color': metric.color }}>
      <input type="checkbox" checked={enabledMetrics.includes(metricId)} onChange={() => toggleMetric(metricId)} />
      {metric.label}
    </label>
  )
}
