// The samples inside a zoom window. Pure arithmetic over an ascending array —
// no React, no Recharts — the counterpart to domain/zoomDomain.js, which
// decides *what window we're looking at* while this decides *what data is in
// it*.
//
// Binary search rather than filter(): this runs on every settled zoom change
// over a full-resolution series (a 1 Hz half-marathon is ~7,000 samples, and
// §7 anticipates 10k), and the array is ascending in both `t` and `d` by the
// Sample contract (domain/types.js) — so a scan would be doing work the
// ordering already rules out.
//
// Total, like its neighbours: a garbage domain or a non-array yields a usable
// array, never a throw. The zoom path is a live gesture, and a throw here
// would take the whole stack down mid-pinch.

/** First index whose x is >= target (i.e. `samples.length` if none is). */
function lowerBound(samples, xKey, target) {
  let lo = 0
  let hi = samples.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid][xKey] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index whose x is > target — the exclusive end of an inclusive window. */
function upperBound(samples, xKey, target) {
  let lo = 0
  let hi = samples.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid][xKey] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The samples whose x falls inside `domain`, bounds INCLUSIVE on both ends.
 *
 * Inclusive because the window's edges are where the user put them: a sample
 * sitting exactly on the left edge is visibly on screen, and dropping it would
 * shorten the window's measured span by one interval.
 *
 * @param {import('./types.js').Sample[]} samples - ascending in `xKey`
 * @param {'t'|'d'} xKey
 * @param {[number, number]} domain - numeric, already resolved (zoomDomain.js)
 * @returns {import('./types.js').Sample[]}
 */
export function sliceSamplesByX(samples, xKey, domain) {
  if (!Array.isArray(samples) || samples.length === 0) return []
  if (!Array.isArray(domain) || !Number.isFinite(domain[0]) || !Number.isFinite(domain[1])) return samples
  const [x0, x1] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]]

  const start = lowerBound(samples, xKey, x0)
  const end = upperBound(samples, xKey, x1)
  if (start < end) return samples.slice(start, end)

  // Empty strict slice. MAX_ZOOM (50) caps the window at 2% of the activity,
  // which on a breadcrumb log — 10-minute sampling over three days — is a
  // window that genuinely contains no sample at all. The line is still drawn
  // across it, as the segment joining the two samples that bracket it, so
  // report on that pair rather than showing nothing: a chip that vanishes
  // while a line is plainly on screen reads as a bug.
  //
  // start === end here, so both bounds agree on the insertion point, and
  // (start - 1, start) is that bracketing pair. At either extreme of the array
  // there is no pair — the window is off the end of the recording and nothing
  // is drawn there either — so the empty slice is the honest answer.
  if (start === 0 || start === samples.length) return []
  return samples.slice(start - 1, start + 1)
}
