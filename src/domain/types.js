// Shared shapes for the domain/data/state layers, expressed as JSDoc typedefs
// so the project can stay plain JS. See ARCHITECTURE.md §5 — binding either way.

/** @typedef {'running'|'cycling'|'track'} Sport - 'track' is a generic GPS log with no sport of its own (GPX only) */
/** @typedef {'pace'|'speed'|'heartRate'|'cadence'|'power'|'altitude'} MetricId */
/** @typedef {'max'|'min'|'avg'|'median'} StatKind */
/** @typedef {'time'|'distance'} XAxisMode */

/**
 * One normalized sample. SI units, always.
 * @typedef {object} Sample
 * @property {number} t - seconds since activity start (monotonic, gap-aware)
 * @property {number} d - cumulative metres (monotonic, non-decreasing)
 * @property {number} [speed] - m/s — pace/speed are derived at display time
 * @property {number} [heartRate] - bpm
 * @property {number} [cadence] - steps/min for running (NOT strides), pedal rpm for cycling
 * @property {number} [power] - watts
 * @property {number} [altitude] - metres
 * @property {boolean} moving - false inside a detected pause
 */

/**
 * The route, pre-projected. Parallel to `Activity.samples` — `x[i]` and
 * `samples[i]` describe the same instant — which holds by construction because
 * `normalizeActivity` builds both from the same filtered trackpoint array.
 * **Nothing in this type system enforces that alignment**, and the map's
 * crosshair lookup rests on it entirely; see domain/buildTrack.js.
 *
 * Typed arrays rather than lat/lon on `Sample`: the render loop wants
 * contiguous, already-projected numbers, and `Sample`'s contract is scalar
 * metrics in SI units. Full rationale in buildTrack.js.
 *
 * @typedef {object} Track
 * @property {Float64Array} x - projected easting, normalised Web Mercator [0,1]; NaN where there was no fix
 * @property {Float64Array} y - projected northing, [0,1], NORTH to SOUTH (screen order); NaN where there was no fix
 * @property {{x0: number, y0: number, x1: number, y1: number}} bounds - over the fixes only
 * @property {number} fixCount - how many slots carry a real position
 */

/**
 * @typedef {object} Activity
 * @property {string} id
 * @property {Sport} sport
 * @property {string} name - inferred (not read verbatim — neither FIT nor TCX has a title field)
 * @property {Date} startTime
 * @property {number} totalTime - s, elapsed
 * @property {number} totalMovingTime - s
 * @property {number} totalDistance - m
 * @property {Sample[]} samples - full resolution
 * @property {number} samplingIntervalS - median gap between samples; every sampling-adaptive threshold reads this
 * @property {MetricId[]} availableMetrics - drives which panels can render
 * @property {Track|null} track - null when the recording carries no GPS at all.
 *   **This null is the map panel's entire availability gate** — deliberately
 *   NOT an entry in `availableMetrics`, which is hashed into `Activity.id`
 *   (domain/activityKey.js) and would fork every remembered view.
 */

/**
 * Untouched adapter output. Adapters do no interpretation beyond field mapping.
 * @typedef {object} RawTrackpoint
 * @property {Date} time
 * @property {number} [distanceMeters]
 * @property {number} [altitudeMeters]
 * @property {number} [heartRateBpm]
 * @property {number} [cadenceSpm] - running: steps/min, already doubled if source was strides. cycling: pedal rpm, undoubled
 * @property {number} [watts]
 * @property {number} [speedMps]
 * @property {number} [lat]
 * @property {number} [lon]
 */

export {}
