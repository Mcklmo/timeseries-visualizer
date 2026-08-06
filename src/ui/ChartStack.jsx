// Vertically stacks one MetricPanel per active metric, sharing syncId and a
// controlled x-domain so panels read as one instrument. See ARCHITECTURE.md
// §7. Only the bottom panel renders the Brush; its onChange writes the one
// zoomDomain that every panel's XAxis reads, so panning/zooming stays synced.
import { metricOrder } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { MetricPanel } from './MetricPanel.jsx'

const FIRST_PANEL_HEIGHT = 200
const OTHER_PANEL_HEIGHT = 140
const BRUSH_HEIGHT = 30

export function ChartStack() {
  const { activity } = useActivity()
  const { xMode, zoomDomain, enabledMetrics, enabledStats, setZoomDomain } = useChartView()

  if (!activity) return null

  const visibleMetrics = metricOrder.filter(
    (id) => activity.availableMetrics.includes(id) && enabledMetrics.includes(id),
  )

  return (
    <div className="chart-stack">
      {visibleMetrics.map((metricId, i) => {
        const isBottom = i === visibleMetrics.length - 1
        const baseHeight = i === 0 ? FIRST_PANEL_HEIGHT : OTHER_PANEL_HEIGHT
        return (
          <MetricPanel
            key={metricId}
            activity={activity}
            metricId={metricId}
            xMode={xMode}
            zoomDomain={zoomDomain}
            enabledStats={enabledStats[metricId] ?? []}
            showXAxis={isBottom}
            showBrush={isBottom}
            onZoomChange={setZoomDomain}
            height={isBottom ? baseHeight + BRUSH_HEIGHT : baseHeight}
          />
        )
      })}
    </div>
  )
}
