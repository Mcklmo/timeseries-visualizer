// THE extension point — see ARCHITECTURE.md §6. Adding a metric (elevation,
// later cycling's leftRightBalance) means adding one object here, nothing
// else. No UI component may hardcode a metric id.
import { formatPace, formatSpeedKmh, mpsToKmh } from '../domain/units.js'

const round = (v) => Math.round(v)

// Derivative axis ticks: the SIGN IS THE READING — "is my heart rate still
// climbing, or has it turned over?" — so a leading + is not decoration, it is
// the thing being communicated. Zero gets no sign at all: it is the axis
// centre, and "+0.0" reads as a small positive.
//
// One decimal for a first derivative and two for a second, because d² numbers
// are ~an order of magnitude smaller at every cadence this app sees.
const signedFixed = (digits) => (v) => {
  if (v == null || !Number.isFinite(v)) return '–'
  const rounded = Number(v.toFixed(digits))
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : ''
  return `${sign}${Math.abs(rounded).toFixed(digits)}`
}
const signed1 = signedFixed(1)
const signed2 = signedFixed(2)

export const metricRegistry = {
  pace: {
    id: 'pace',
    label: 'Pace',
    unit: 'min/km',
    color: 'var(--metric-pace)',
    accessor: (s) => (s.speed && s.speed > 0.3 ? 1000 / s.speed : null),
    format: formatPace,
    invertAxis: true, // faster reads higher
    aggStrategy: 'weightedPace',
    domainPadding: 0.08,
    // Deliberately not 'track': min/km is meaningless at breadcrumb sampling
    // (and the accessor nulls out anything under 0.3 m/s anyway), so a GPS
    // track shows speed instead.
    sports: ['running'],
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    unit: 'km/h',
    color: 'var(--metric-pace)', // shares pace's hue deliberately — the two never render together
    accessor: (s) => (s.speed != null ? mpsToKmh(s.speed) : null),
    format: formatSpeedKmh,
    invertAxis: false,
    // Accessor units are km/h, so per-second differences arrive as (km/h)/s —
    // the ÷3.6 is what turns them into the m/s² a rider actually reads.
    derivative: {
      d1: { label: 'acceleration', unit: 'm/s²', perSecondScale: 1 / 3.6, format: signed2 },
      d2: { label: 'jerk', unit: 'm/s³', perSecondScale: 1 / 3.6, format: signed2 },
    },
    // Unlike pace, average speed IS the time-weighted mean of instantaneous
    // speed by definition — no reciprocal-avoidance needed. movingOnly still
    // excludes paused samples, same reasoning as cadence below.
    aggStrategy: 'movingOnly',
    domainPadding: 0.08,
    sports: ['cycling', 'track'],
  },
  heartRate: {
    id: 'heartRate',
    label: 'Heart rate',
    unit: 'bpm',
    color: 'var(--metric-heartrate)',
    accessor: (s) => s.heartRate ?? null,
    format: round,
    invertAxis: false,
    aggStrategy: 'timeWeighted',
    // Per minute rather than per second: a hard interval start is ~0.15 bpm/s,
    // which reads as noise, and ~9 bpm/min, which reads as a number.
    derivative: {
      d1: { label: 'ramp', unit: 'bpm/min', perSecondScale: 60, format: signed1 },
      d2: { label: 'ramp accel', unit: 'bpm/min²', perSecondScale: 3600, format: signed2 },
    },
    sports: ['running', 'cycling', 'track'],
  },
  cadence: {
    id: 'cadence',
    label: 'Cadence',
    unit: (sport) => (sport === 'cycling' ? 'rpm' : 'spm'),
    color: 'var(--metric-cadence)',
    accessor: (s) => s.cadence ?? null,
    format: round,
    invertAxis: false,
    aggStrategy: 'movingOnly',
    domainPadding: 0.08,
    sports: ['running', 'cycling', 'track'],
  },
  power: {
    id: 'power',
    label: 'Power',
    unit: 'W',
    color: 'var(--metric-power)',
    accessor: (s) => s.power ?? null,
    format: round,
    invertAxis: false,
    aggStrategy: 'timeWeighted',
    // Watts per second already reads naturally — a sprint wind-up is tens of
    // W/s — so no rescaling, unlike heart rate.
    derivative: {
      d1: { label: 'ramp', unit: 'W/s', perSecondScale: 1, format: signed1 },
      d2: { label: 'ramp accel', unit: 'W/s²', perSecondScale: 1, format: signed2 },
    },
    sports: ['running', 'cycling', 'track'],
  },
  altitude: {
    id: 'altitude',
    label: 'Elevation',
    unit: 'm',
    color: 'var(--metric-altitude)',
    accessor: (s) => s.altitude ?? null,
    format: round,
    invertAxis: false,
    aggStrategy: 'timeWeighted',
    // Metres per minute is how climbing is talked about (a steady 900 m/h climb
    // is 15 m/min); m/s would put every real value under 0.5.
    derivative: {
      d1: { label: 'climb rate', unit: 'm/min', perSecondScale: 60, format: signed1 },
      d2: { label: 'climb accel', unit: 'm/min²', perSecondScale: 3600, format: signed2 },
    },
    sports: ['running', 'cycling', 'track'],
  },
}

export const metricOrder = ['pace', 'speed', 'heartRate', 'power', 'cadence', 'altitude']

/** The four scalar stats (§5): one number each, drawn as a horizontal
 *  ReferenceLine and reported as a chip. */
export const scalarStatKinds = ['max', 'min', 'avg', 'median']

/** The two derivative overlays (§6). Not scalars — each is a whole SERIES in
 *  units that differ from the metric's own, drawn as a dashed line on a second
 *  right-hand y-axis. `stats/aggregate.js` must never see one; it rejects them
 *  explicitly. Offered only by metrics that declare a `derivative` spec. */
export const derivativeStatKinds = ['d1', 'd2']

/** Every StatKind (§5), in the order they are offered and drawn. THE list —
 *  `MetricPanel`, `StatCheckboxes` and `state/viewPrefsStore.js` all read it
 *  rather than writing the strings out again.
 *
 *  Kept as ONE list, with the derivative kinds appended last, so that
 *  `enabledStats`, `toggleStat` and the persisted prefs stay a single
 *  mechanism — a second parallel "enabled derivatives" map would have to be
 *  toggled, persisted, migrated and kept in sync with this one. Order is
 *  load-bearing in three places: checkbox order, draw order, and the order
 *  `viewPrefsStore`'s `filterToKnown` re-sorts stored prefs into. */
export const statKinds = [...scalarStatKinds, ...derivativeStatKinds]

/**
 * The kinds one metric actually offers. Derivatives are opt-in per metric
 * rather than universal: `pace`'s accessor nulls everything under 0.3 m/s and
 * d/dt of min/km is unreadable, and a rate of change of cadence answers no
 * question anyone asks. Both therefore declare no `derivative` and show four
 * boxes where the rest show six.
 *
 * @param {object} metric - a metricRegistry entry
 * @returns {string[]}
 */
export function statKindsFor(metric) {
  return metric.derivative ? statKinds : scalarStatKinds
}

/**
 * The derivative a metric is actually showing: a kind that is both enabled AND
 * declared by that metric. At most one — ChartViewContext's toggleStat clears
 * the other whenever one is switched on.
 *
 * ONE definition, read by both `ChartStack` (which reserves the stack-wide
 * right-hand gutter) and `MetricPanel` (which draws the overlay into it). The
 * two must never disagree: a gutter reserved for an overlay that never renders
 * is 44px of dead chrome on every panel, and an overlay drawn without a gutter
 * has no axis to attach to. The `metric.derivative` half is not hypothetical —
 * `viewPrefsStore` validates stored kinds against the global `statKinds`, so a
 * hand-edited sessionStorage entry can carry 'd1' for `cadence`.
 *
 * @param {object} metric - a metricRegistry entry
 * @param {string[]} enabledKinds - that metric's entry in enabledStats
 * @returns {'d1'|'d2'|null}
 */
export function derivativeKindFor(metric, enabledKinds) {
  if (!metric.derivative) return null
  return enabledKinds.find((kind) => derivativeStatKinds.includes(kind) && metric.derivative[kind]) ?? null
}

/** Resolves a metric's display unit, which may vary by sport (e.g. cadence: spm vs rpm). */
export function metricUnit(metric, sport) {
  return typeof metric.unit === 'function' ? metric.unit(sport) : metric.unit
}

/** Whether a metric should be offered/rendered for a given activity's sport. */
export function isMetricForSport(metricId, sport) {
  return metricRegistry[metricId].sports.includes(sport)
}
