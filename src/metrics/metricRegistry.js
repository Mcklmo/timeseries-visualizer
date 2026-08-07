// THE extension point — see ARCHITECTURE.md §6. Adding a metric (elevation,
// later cycling's leftRightBalance) means adding one object here, nothing
// else. No UI component may hardcode a metric id.
import { formatPace, formatSpeedKmh, mpsToKmh } from '../domain/units.js'

const round = (v) => Math.round(v)

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
    sports: ['running', 'cycling', 'track'],
  },
}

export const metricOrder = ['pace', 'speed', 'heartRate', 'power', 'cadence', 'altitude']

/** Resolves a metric's display unit, which may vary by sport (e.g. cadence: spm vs rpm). */
export function metricUnit(metric, sport) {
  return typeof metric.unit === 'function' ? metric.unit(sport) : metric.unit
}

/** Whether a metric should be offered/rendered for a given activity's sport. */
export function isMetricForSport(metricId, sport) {
  return metricRegistry[metricId].sports.includes(sport)
}
