// Shared shapes for the domain/data/state layers, expressed as JSDoc typedefs
// so the project can stay plain JS. See ARCHITECTURE.md §5 — binding either way.

/** @typedef {'running'} Sport */
/** @typedef {'pace'|'heartRate'|'cadence'|'power'|'altitude'} MetricId */
/** @typedef {'max'|'avg'|'median'} StatKind */
/** @typedef {'time'|'distance'} XAxisMode */

/**
 * One normalized sample. SI units, always.
 * @typedef {object} Sample
 * @property {number} t - seconds since activity start (monotonic, gap-aware)
 * @property {number} d - cumulative metres (monotonic, non-decreasing)
 * @property {number} [speed] - m/s — pace is derived at display time
 * @property {number} [heartRate] - bpm
 * @property {number} [cadence] - steps per minute (NOT strides)
 * @property {number} [power] - watts
 * @property {number} [altitude] - metres
 * @property {boolean} moving - false inside a detected pause
 */

/**
 * @typedef {object} Activity
 * @property {string} id
 * @property {Sport} sport
 * @property {Date} startTime
 * @property {number} totalTime - s, elapsed
 * @property {number} totalMovingTime - s
 * @property {number} totalDistance - m
 * @property {Sample[]} samples - full resolution
 * @property {MetricId[]} availableMetrics - drives which panels can render
 */

/**
 * Untouched adapter output. Adapters do no interpretation beyond field mapping.
 * @typedef {object} RawTrackpoint
 * @property {Date} time
 * @property {number} [distanceMeters]
 * @property {number} [altitudeMeters]
 * @property {number} [heartRateBpm]
 * @property {number} [cadenceSpm] - already doubled if source was strides
 * @property {number} [watts]
 * @property {number} [speedMps]
 * @property {number} [lat]
 * @property {number} [lon]
 */

export {}
