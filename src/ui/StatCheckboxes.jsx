// Per-metric stat checkboxes: the four scalar reference lines, plus the two
// derivative overlays on the metrics that offer them. See ARCHITECTURE.md
// §10 — enabledStats is keyed per metric on purpose, so "avg heart rate" and
// "avg pace" toggle independently. Each input carries an explicit aria-label
// ("Heart rate max") since three checkboxes on the page are all just named
// "max" visually — the metric name alone would collide across rows.
import { metricRegistry, statKindsFor } from '../metrics/metricRegistry.js'
import { useChartView } from '../state/ChartViewContext.jsx'

// Presentation only, and deliberately NOT in the registry — same category as
// MetricPanel's STAT_DASH. 'd1'/'d2' are the persisted state's names for these
// kinds and are meaningless on screen; the scalar kinds are already their own
// labels, so only the derivatives need an entry.
const KIND_LABEL = { d1: 'd/dt', d2: 'd²/dt²' }

/**
 * The visible text for a derivative is a formula, which no screen reader
 * should be made to spell out, so the accessible name comes from the
 * registry's prose label instead: "Heart rate ramp", "Elevation climb rate".
 *
 * Exported because the accessible name is how tests address these checkboxes,
 * and a test that spelled the rule out again would be a second copy free to
 * drift from this one.
 *
 * @param {object} metric - a metricRegistry entry
 * @param {string} kind
 * @returns {string}
 */
export function statCheckboxLabel(metric, kind) {
  const spec = metric.derivative?.[kind]
  return `${metric.label} ${spec ? spec.label : kind}`
}

export function StatCheckboxes({ metricId }) {
  const metric = metricRegistry[metricId]
  const { enabledStats, toggleStat } = useChartView()
  const enabled = enabledStats[metricId] ?? []

  return (
    <span className="stat-checkboxes">
      {statKindsFor(metric).map((kind) => {
        const checked = enabled.includes(kind)
        // Derivative kinds only. The accent means "derived", not "checked" —
        // the four scalar kinds stay dim when on, exactly as they are now.
        const isDeriv = metric.derivative?.[kind] != null

        return (
          <label key={kind} className={`stat-checkbox${isDeriv && checked ? ' stat-checkbox--active' : ''}`}>
            <input
              type="checkbox"
              aria-label={statCheckboxLabel(metric, kind)}
              checked={checked}
              onChange={() => toggleStat(metricId, kind)}
            />
            <span aria-hidden="true">{KIND_LABEL[kind] ?? kind}</span>
          </label>
        )
      })}
    </span>
  )
}
