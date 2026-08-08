// One row in an activity picker, in terms no provider owns. Every provider
// maps its own payload into this shape at its API boundary, so ActivityRowList
// and activityDateRange can be written once and reused unchanged — which is
// the whole reason it exists: the intervals.icu list used to read
// `icu_distance` and `start_date_local` straight off the wire, and Strava's
// payload shares neither name.
//
// **Typedef only, zero imports.** A file that carries no code cannot pull a
// dependency across a layer boundary in either direction, which is what lets
// both `data/intervals/` and `ui/` name this shape freely.
//
// `provider` is deliberately NOT a field here. Telling one provider's id from
// another's is the job of the ref that gets dispatched on
// (ActivitySource.js's IdActivityRef), not of the row that gets rendered —
// putting it here would give every list component a reason to branch on it.

/**
 * Nulls rather than absent keys for the optional data, so a consumer reads
 * `row.distanceM != null` and never has to know whether the provider omitted
 * the field or reported something unusable. The two exceptions are deliberate:
 * `name` is absent rather than null so `||` falls through to a rendered
 * placeholder, and `isGarminDerived` is a plain boolean because "we don't
 * know" is not a state attribution law recognises.
 *
 * @typedef {object} ActivityRow
 * @property {string} id
 * @property {string} [name]              - absent, never empty-string
 * @property {string|null} startedAt      - the athlete's local wall clock; no trailing Z, ever
 * @property {number|null} distanceM      - null unless finite and > 0
 * @property {number|null} durationS      - null unless finite and > 0
 * @property {string|null} sportLabel     - e.g. 'Run'; the meta line loses the sport without it
 * @property {string|null} unsupportedReason - why this row can't be loaded, or null if it can
 * @property {boolean} isGarminDerived    - drives the attribution both intervals.icu's API
 *                                          Terms §1.1 and Strava's API Policy §4.4 require
 */

export {}
