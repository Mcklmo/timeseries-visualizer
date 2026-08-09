// Which of a Track's points are worth stroking at a given canvas size.
//
// A 20k-sample ride fitted into a 240px-tall panel puts something like fifty
// points on every pixel. Stroking all of them is not just wasted time, it is
// wasted *ink*: overlapping sub-pixel segments darken the line and turn a
// stationary minute at a traffic light into a visible blob. Dropping anything
// within `minPx` of the last kept point costs at most `minPx` of positional
// error — sub-pixel by construction — and typically removes 90%+ of the points.
//
// **Runs once per resize, never per frame.** That is the whole reason the map
// fits the full route once and never re-fits on zoom (the framing decision in
// the brief): with a fixed fit, this and the projection in buildTrack.js are
// both load-time costs, and a hover frame is a clearRect plus one arc.
//
// **This is NOT downsample.js and must not move into it.** That module is
// reserved for LTTB over a chart series (ARCHITECTURE.md §7) — a different
// algorithm answering a different question. LTTB preserves the *visual extrema
// of a value against one axis*, which is what you want for a heart-rate trace
// and meaningless for a closed loop in two dimensions; and it targets a fixed
// output count, where this targets a fixed output *resolution*.
//
// Radial-distance decimation rather than Douglas–Peucker, deliberately.
// Douglas–Peucker preserves shape better per point kept, but it is recursive,
// O(n log n) at best and O(n²) on adversarial input, and its error metric is
// perpendicular distance from a chord — which on a switchback or a running
// track collapses exactly the doubling-back this map exists to show. Radial
// decimation's error is bounded by `minPx` in every direction, uniformly.

/**
 * The distance below which two points are the same point, in CSS pixels.
 *
 * Below one pixel on purpose: at exactly 1 the decimation is visible as
 * faceting on tight curves (a running track's bends become polygons), because
 * the kept points land up to a pixel off the true path *and* the error is
 * correlated along the curve. 0.75 is far enough under that to be invisible at
 * both DPR 1 and DPR 2 while still collapsing the dense clusters that motivate
 * this at all.
 */
export const DEFAULT_MIN_PX = 0.75

/**
 * @param {import('./types.js').Track} track
 * @param {{scale: number, offsetX: number, offsetY: number}} fit - the affine
 *   transform from normalised Mercator to canvas pixels (map/fitBounds.js).
 *   Only `scale` is read: the offsets are a translation and cancel in a
 *   difference. Taken whole anyway, so callers pass the thing they already have
 *   rather than remembering which field matters.
 * @param {number} [minPx]
 * @returns {Int32Array} indices into `track.x`/`track.y` — and therefore into
 *   `activity.samples` — ascending, to be stroked in order.
 *
 *   **Indices into the ORIGINAL arrays, not a compacted copy of the points.**
 *   That is what lets the zoom window's sub-segment be located later: the
 *   window is a range of sample indices, and this array is ascending, so a
 *   binary search finds where it starts and ends. A compacted `{x, y}[]` would
 *   have thrown away the only thing linking a drawn vertex back to an instant.
 *
 *   Gaps survive decimation: the first index of every NaN run is kept, so
 *   drawRoute still sees the break and lifts the pen. A dropout is a gap, not a
 *   straight line across a city.
 */
export function simplifyTrack(track, fit, minPx = DEFAULT_MIN_PX) {
  if (!track || !fit) return new Int32Array(0)

  const { x, y } = track
  const scale = Number.isFinite(fit.scale) ? fit.scale : 0
  const threshold = Number.isFinite(minPx) && minPx > 0 ? minPx : 0
  // Compared against the SQUARED separation, so the per-point cost is two
  // multiplies rather than a sqrt. On 20k points that is the difference
  // between this being free and this being measurable.
  const thresholdSq = threshold * threshold

  // Worst case is "keep everything", so allocate once at full length and hand
  // back a subarray. Growing an ordinary array and converting at the end would
  // copy the whole thing a second time.
  const kept = new Int32Array(x.length)
  let n = 0

  let lastX = 0
  let lastY = 0
  // Distinct from "the last index kept": after a gap there IS no previous
  // point to measure against, and the first fix of a new run must always be
  // kept or the stroke would resume from wherever the pen happens to be.
  let hasLast = false

  for (let i = 0; i < x.length; i += 1) {
    const px = x[i] * scale
    const py = y[i] * scale

    if (Number.isNaN(px) || Number.isNaN(py)) {
      // One marker per run, not one per missing sample: a receiver that loses
      // sky for ten minutes at 1 Hz emits 600 of these and they all mean the
      // same single thing. `hasLast` doubles as the run flag — it is false for
      // the whole of a gap, so only the first NaN gets recorded.
      if (hasLast) {
        kept[n] = i
        n += 1
        hasLast = false
      }
      continue
    }

    if (hasLast) {
      const dx = px - lastX
      const dy = py - lastY
      if (dx * dx + dy * dy < thresholdSq) continue
    }

    kept[n] = i
    n += 1
    lastX = px
    lastY = py
    hasLast = true
  }

  return kept.subarray(0, n)
}

/**
 * Where `sampleIndex` sits in an ascending index array — the first slot whose
 * value is >= it, i.e. `indices.length` if none is.
 *
 * The counterpart to domain/sliceSamples.js's own binary search, in the one
 * other index space this app has. Kept here rather than generalised into that
 * module because that one searches `Sample[]` by a property key and this
 * searches a flat Int32Array; sharing them would mean an accessor call per
 * probe on the hot path of both.
 *
 * @param {Int32Array} indices - ascending, as returned by simplifyTrack
 * @param {number} sampleIndex
 * @returns {number}
 */
export function keptIndexAtOrAfter(indices, sampleIndex) {
  let lo = 0
  let hi = indices.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (indices[mid] < sampleIndex) lo = mid + 1
    else hi = mid
  }
  return lo
}
