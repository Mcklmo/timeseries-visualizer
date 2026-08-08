// Shared Recharts <Tooltip content> for every MetricPanel, so the hovered
// sample reads identically everywhere. Header always shows both elapsed time
// and distance — see ARCHITECTURE.md §7 — regardless of which one is the
// active x-axis mode, since users think in both.
import { formatDuration, formatDistanceKm } from '../domain/units.js'
import { metricUnit } from '../metrics/metricRegistry.js'

/**
 * @param {object} props
 * @param {object} props.metric - the registry entry this panel draws
 * @param {string} [props.sport]
 * @param {{key: string, spec: {unit: string, format: (v: number) => string}}|null} [props.derivative]
 *   - the overlay's row key and display spec while one is switched on
 */
export function SyncedTooltip({ active, payload, metric, sport, derivative }) {
  if (!active || !payload || payload.length === 0) return null

  // Selected BY dataKey, never by position. A panel with a derivative overlay
  // puts two <Line>s in the payload and Recharts does not specify their order,
  // so the old `payload[0]` would have shown the rate under the metric's own
  // name and unit roughly half the time.
  const metricEntry = payload.find((entry) => entry.dataKey === metric.id)
  const derivEntry = derivative == null ? undefined : payload.find((entry) => entry.dataKey === derivative.key)

  // The x/y position comes off whichever entry is present: both carry the same
  // row, and a hover can legitimately land where only one of them has a value.
  const point = (metricEntry ?? derivEntry ?? payload[0]).payload
  const value = metricEntry?.value
  const formatted = value == null ? '–' : metric.format(value)

  return (
    <div className="synced-tooltip">
      <div className="synced-tooltip-header">
        {formatDuration(point.t)} · {formatDistanceKm(point.d)}
      </div>
      <div className="synced-tooltip-value">
        {metric.label}: {formatted} {metricUnit(metric, sport)}
      </div>
      {derivEntry !== undefined && (
        <div className="synced-tooltip-value">
          {derivative.spec.label}: {derivEntry.value == null ? '–' : derivative.spec.format(derivEntry.value)}{' '}
          {derivative.spec.unit}
        </div>
      )}
    </div>
  )
}
