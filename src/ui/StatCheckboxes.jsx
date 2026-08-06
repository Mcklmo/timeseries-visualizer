// Per-metric max/avg/median reference-line checkboxes. See ARCHITECTURE.md
// §10 — enabledStats is keyed per metric on purpose, so "avg heart rate" and
// "avg pace" toggle independently. Each input carries an explicit aria-label
// ("Heart rate max") since three checkboxes on the page are all just named
// "max" visually — the metric name alone would collide across rows.
import { metricRegistry } from '../metrics/metricRegistry.js'
import { useChartView } from '../state/ChartViewContext.jsx'

const STAT_KINDS = ['max', 'avg', 'median']

export function StatCheckboxes({ metricId }) {
  const metric = metricRegistry[metricId]
  const { enabledStats, toggleStat } = useChartView()
  const enabled = enabledStats[metricId] ?? []

  return (
    <span className="stat-checkboxes">
      {STAT_KINDS.map((kind) => (
        <label key={kind} className="stat-checkbox">
          <input
            type="checkbox"
            aria-label={`${metric.label} ${kind}`}
            checked={enabled.includes(kind)}
            onChange={() => toggleStat(metricId, kind)}
          />
          <span aria-hidden="true">{kind}</span>
        </label>
      ))}
    </span>
  )
}
