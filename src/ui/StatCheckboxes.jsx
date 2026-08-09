// Per-metric stat checkboxes: the four scalar reference lines, plus the two
// derivative overlays on the metrics that offer them. See ARCHITECTURE.md
// §10 — enabledStats is keyed per metric on purpose, so "avg heart rate" and
// "avg pace" toggle independently. They live behind the unfold arrow in each
// panel's own head now, one instance per graph, rather than stacked in a
// single settings window. Each input still carries an explicit aria-label
// ("Heart rate max") since every graph's head offers a box named just "max"
// visually — the visible text alone would collide across panels.
import { metricRegistry, statKindsFor } from '../metrics/metricRegistry.js'
import { derivativeStroke } from './derivativeStyle.js'

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

/**
 * PROP-DRIVEN, NOT CONTEXT-DRIVEN, since these boxes moved into the panel head.
 * `MetricPanel` reads no context by design — its whole test file renders it
 * bare — and `enabledStats` was already a prop there, so `toggleStat` comes
 * down beside it from `ChartStack`, which is the component that does read
 * `ChartViewContext`. `onToggle` must stay routed through that same
 * `toggleStat`: it is what enforces at most one derivative per metric.
 *
 * @param {object} props
 * @param {string} props.metricId
 * @param {string[]} [props.enabled] - this metric's enabled stat kinds
 * @param {(metricId: string, kind: string) => void} [props.onToggle]
 */
export function StatCheckboxes({ metricId, enabled = [], onToggle }) {
  const metric = metricRegistry[metricId]

  return (
    <span className="stat-checkboxes">
      {statKindsFor(metric).map((kind) => {
        const checked = enabled.includes(kind)
        // Derivative kinds only. The tint means "derived", not "checked" — the
        // four scalar kinds stay dim when on, exactly as they are now.
        const isDeriv = metric.derivative?.[kind] != null

        return (
          <label
            key={kind}
            className={`stat-checkbox${isDeriv && checked ? ' stat-checkbox--active' : ''}`}
            // The box is drawn in the colour of the line it draws — per metric,
            // not one shared accent. The shared accent was the bug: it promised
            // cyan and produced a pale pink line for every metric but `speed`.
            style={isDeriv ? { '--deriv-hue': derivativeStroke(metric) } : undefined}
          >
            <input
              type="checkbox"
              aria-label={statCheckboxLabel(metric, kind)}
              checked={checked}
              onChange={() => onToggle?.(metricId, kind)}
            />
            <span aria-hidden="true">{KIND_LABEL[kind] ?? kind}</span>
          </label>
        )
      })}
    </span>
  )
}
