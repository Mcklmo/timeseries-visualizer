// Vertically stacks one MetricPanel per active metric, sharing syncId and a
// controlled x-domain so panels read as one instrument. See ARCHITECTURE.md
// §7. Brush + zoomDomain wiring lands in a later build step (§11 step 7).
import { metricOrder } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { MetricPanel } from './MetricPanel.jsx'

const FIRST_PANEL_HEIGHT = 200
const OTHER_PANEL_HEIGHT = 140

export function ChartStack() {
  const { activity } = useActivity()
  const { xMode, zoomDomain, enabledMetrics, enabledStats } = useChartView()

  if (!activity) return null

  const visibleMetrics = metricOrder.filter(
    (id) => activity.availableMetrics.includes(id) && enabledMetrics.includes(id),
  )

  return (
    <div className="chart-stack">
      {visibleMetrics.map((metricId, i) => (
        <MetricPanel
          key={metricId}
          activity={activity}
          metricId={metricId}
          xMode={xMode}
          zoomDomain={zoomDomain}
          enabledStats={enabledStats[metricId] ?? []}
          showXAxis={i === visibleMetrics.length - 1}
          height={i === 0 ? FIRST_PANEL_HEIGHT : OTHER_PANEL_HEIGHT}
        />
      ))}
    </div>
  )
}
