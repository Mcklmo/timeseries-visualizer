// THE extension point — see ARCHITECTURE.md §6. Adding a metric (elevation,
// later cycling's leftRightBalance) means adding one object here, nothing
// else. No UI component may hardcode a metric id.
import { formatPace } from '../domain/units.js'

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
    sports: ['running', 'cycling'],
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
    sports: ['running', 'cycling'],
  },
  cadence: {
    id: 'cadence',
    label: 'Cadence',
    unit: 'spm',
    color: 'var(--metric-cadence)',
    accessor: (s) => s.cadence ?? null,
    format: round,
    invertAxis: false,
    aggStrategy: 'movingOnly',
    sports: ['running'],
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
    sports: ['running', 'cycling'],
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
    sports: ['running', 'cycling'],
  },
}

export const metricOrder = ['pace', 'heartRate', 'power', 'cadence', 'altitude']
