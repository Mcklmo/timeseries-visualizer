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

/**
 * Where a single x value sits in `samples` — the first index at or after it.
 *
 * The map's crosshair lookup. `<Tooltip content>` publishes the hovered row's
 * `{t, d}` rather than an index, because the index Recharts hands out
 * (`activeIndex`) counts the gap-break rows insertGapBreaks.js splices into the
 * CHART data and diverges from the sample array after the first dropout — see
 * ui/crosshairBus.js. So the position comes back as a value and is resolved
 * here, in O(log n) against ~20k samples, which is nothing per hover frame.
 *
 * A thin wrapper on `lowerBound` rather than a second binary search: the
 * off-by-ones in one of these are hard enough to get right once.
 *
 * @param {import('./types.js').Sample[]} samples - ascending in `xKey`
 * @param {'t'|'d'} xKey
 * @param {number} value
 * @returns {number} 0..samples.length — clamped to the last real index, so the
 *   result is always safe to use as a subscript on a non-empty array
 */
export function indexAtX(samples, xKey, value) {
  if (!Array.isArray(samples) || samples.length === 0) return 0
  if (!Number.isFinite(value)) return 0
  const i = lowerBound(samples, xKey, value)
  return i >= samples.length ? samples.length - 1 : i
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
 * Where `domain` starts and ends in `samples`, as a half-open index range,
 * bounds INCLUSIVE of the edges.
 *
 * Inclusive because the window's edges are where the user put them: a sample
 * sitting exactly on the left edge is visibly on screen, and dropping it would
 * shorten the window's measured span by one interval.
 *
 * The bounds are the primitive and the slice below is built on them, because
 * two callers want the window without paying for the copy. `elapsedTimeFor`
 * (stats/statsBasis.js) reads only the two end samples and now runs on every
 * animation frame of a live gesture; `displayIndices` (domain/downsample.js)
 * picks indices *inside* the range and would only have to find them again.
 *
 * @param {import('./types.js').Sample[]} samples - ascending in `xKey`
 * @param {'t'|'d'} xKey
 * @param {unknown} domain - numeric pair (zoomDomain.js), or anything at all
 * @returns {[number, number]} `[start, end)`; `[0, 0]` when nothing is in view
 */
export function sliceBoundsByX(samples, xKey, domain) {
  if (!Array.isArray(samples) || samples.length === 0) return [0, 0]
  // A garbage domain is the whole array, not an empty window — see the file
  // header on why this is total rather than defensive.
  if (!Array.isArray(domain) || !Number.isFinite(domain[0]) || !Number.isFinite(domain[1])) {
    return [0, samples.length]
  }
  const [x0, x1] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]]

  const start = lowerBound(samples, xKey, x0)
  const end = upperBound(samples, xKey, x1)
  if (start < end) return [start, end]

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
  // is drawn there either — so the empty range is the honest answer.
  if (start === 0 || start === samples.length) return [0, 0]
  return [start - 1, start + 1]
}

/**
 * The samples whose x falls inside `domain`, bounds INCLUSIVE on both ends.
 *
 * @param {import('./types.js').Sample[]} samples - ascending in `xKey`
 * @param {'t'|'d'} xKey
 * @param {[number, number]} domain - numeric, already resolved (zoomDomain.js)
 * @returns {import('./types.js').Sample[]}
 */
export function sliceSamplesByX(samples, xKey, domain) {
  if (!Array.isArray(samples) || samples.length === 0) return []
  // Kept here rather than read back out of sliceBoundsByX's [0, length], and
  // deliberately the ONLY by-reference return: a garbage domain hands back the
  // activity's own array, which is what statsBasisFor's unzoomed guarantee
  // rests on (§6 — the default render stays byte-identical). A numeric domain
  // that happens to span the whole extent still copies, as it always has;
  // snapToFull means the app itself never takes that path.
  if (!Array.isArray(domain) || !Number.isFinite(domain[0]) || !Number.isFinite(domain[1])) return samples

  const [start, end] = sliceBoundsByX(samples, xKey, domain)
  if (start === end) return []
  return samples.slice(start, end)
}
