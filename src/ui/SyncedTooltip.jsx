// Shared Recharts <Tooltip content> for every MetricPanel, so the hovered
// sample reads identically everywhere. Header always shows both elapsed time
// and distance — see ARCHITECTURE.md §7 — regardless of which one is the
// active x-axis mode, since users think in both.
import { formatDuration, formatDistanceKm } from '../domain/units.js'
import { metricUnit } from '../metrics/metricRegistry.js'

export function SyncedTooltip({ active, payload, metric, sport }) {
  if (!active || !payload || payload.length === 0) return null
  const { value, payload: point } = payload[0]
  const formatted = value == null ? '–' : metric.format(value)

  return (
    <div className="synced-tooltip">
      <div className="synced-tooltip-header">
        {formatDuration(point.t)} · {formatDistanceKm(point.d)}
      </div>
      <div className="synced-tooltip-value">
        {metric.label}: {formatted} {metricUnit(metric, sport)}
      </div>
    </div>
  )
}
