// Display-only: makes a recording dropout render as a real break in the line
// instead of an invented straight diagonal across it. `connectNulls={false}`
// already breaks the line at a null (ARCHITECTURE.md §7), but sparse data
// contains no nulls of its own — a six-hour satellite outage looks exactly
// like the next breadcrumb — so there is nothing to break on until one is
// inserted here.
//
// Deliberately NOT a Sample field: synthetic entries in `activity.samples`
// would corrupt sampleDurations, the distance axis, and every stat computed
// from them. Confining insertion to the chart's own row array keeps
// `activity.samples` full-resolution, as §7 requires. Same category as
// domain/downsample.js — a pure display helper that happens to live in
// domain/ (§4).

/**
 * @param {{t: number, d: number}[]} rows - chart rows, ascending in t
 * @param {object} args
 * @param {string} args.metricId - the plotted key; nulled on the synthetic row
 * @param {number} args.gapThresholdS - a t delta above this counts as a dropout
 * @returns {object[]} rows, with a null-valued row inserted inside each gap
 */
export function insertGapBreaks(rows, { metricId, gapThresholdS }) {
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const prev = rows[i - 1]
    if (prev !== undefined && row.t - prev.t > gapThresholdS) {
      // Carries BOTH axis keys, not just the active one: xKey flips with
      // xMode, and a row missing the key the axis is reading would be dropped
      // off the chart rather than breaking the line. The midpoint is only a
      // placeholder position — nothing is plotted there, the value is null.
      out.push({ t: (prev.t + row.t) / 2, d: (prev.d + row.d) / 2, [metricId]: null })
    }
    out.push(row)
  }
  return out
}
