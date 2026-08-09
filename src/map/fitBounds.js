// The one affine transform the map panel draws through: normalised Web
// Mercator (the unit square, domain/webMercator.js) -> CSS pixels on the
// canvas.
//
//   px = x * scale + offsetX
//   py = y * scale + offsetY
//
// ONE scale for both axes, never two. Mercator is conformal — angles and local
// shape are correct — and a per-axis scale would throw that away, which is
// precisely the distortion the projection was chosen to avoid in the first
// place (see webMercator.js). So the route is fitted to whichever axis binds
// and centred on the other.
//
// **Computed once per resize and then held.** The map fits the whole route and
// never re-fits as the charts are zoomed: the zoom window is drawn as a bright
// sub-segment over a dimmed whole instead. That decision is what makes every
// per-frame cost in this feature trivial — the projection, the simplification
// and the tile set are all functions of this transform, so all three are
// load-time work rather than frame work.

/**
 * Breathing room around the route, in CSS pixels.
 *
 * Not decoration: the stroke has width, and a route fitted edge-to-edge has
 * half of it clipped along whichever side binds — which reads as the route
 * running off the panel rather than as a tight fit. It also leaves the marker
 * somewhere to sit when the crosshair is at the very start or end.
 */
export const DEFAULT_PADDING = 8

/**
 * @param {{x0: number, y0: number, x1: number, y1: number}} bounds - normalised
 *   Mercator, as `Track.bounds`
 * @param {{width: number, height: number, padding?: number}} canvas - CSS pixels
 * @returns {{scale: number, offsetX: number, offsetY: number}}
 */
export function fitFor(bounds, { width, height, padding = DEFAULT_PADDING }) {
  const spanX = bounds.x1 - bounds.x0
  const spanY = bounds.y1 - bounds.y0

  // Math.max(0, …) rather than trusting the subtraction: a panel narrower than
  // twice the padding would otherwise give a negative inner size and a
  // negative scale, which mirrors the whole map about its centre — a
  // spectacular failure for a two-pixel window nobody is looking at.
  const innerW = Math.max(0, width - 2 * padding)
  const innerH = Math.max(0, height - 2 * padding)

  // A zero span means the route does not extend in that direction at all
  // (a single fix, or a perfectly north-south line). Infinity makes that axis
  // lose the min() below rather than divide by zero, so the OTHER axis decides
  // the scale — which is the right answer for a straight line, and leaves the
  // both-zero case to the guard underneath.
  const scaleX = spanX > 0 ? innerW / spanX : Infinity
  const scaleY = spanY > 0 ? innerH / spanY : Infinity
  let scale = Math.min(scaleX, scaleY)

  // One fix, or a route of zero extent: there is nothing to scale to, so any
  // finite scale is as good as any other and the centring below is what
  // actually matters. 1 keeps the arithmetic in range; the point lands in the
  // middle of the panel either way.
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  // Centre the bbox's midpoint on the canvas's midpoint. This is what applies
  // the padding on the non-binding axis too — it ends up with more than
  // `padding`, which is correct: the route is centred in the space it did not
  // need rather than pinned to one edge of it.
  const offsetX = width / 2 - (bounds.x0 + spanX / 2) * scale
  const offsetY = height / 2 - (bounds.y0 + spanY / 2) * scale

  return { scale, offsetX, offsetY }
}

/**
 * The inverse: which part of the unit square is actually on screen.
 *
 * Needed because the canvas shows strictly MORE than the route's own bbox — the
 * padding, plus whatever slack the non-binding axis was left with — and the
 * basemap has to cover all of it, not just the part with route on it. Feeding
 * `Track.bounds` to the tile math instead would leave unpainted panel around
 * the edges of every route that is not exactly the panel's aspect ratio, which
 * is all of them.
 *
 * Clamped into [0,1]: a short route near the antimeridian or in the far north
 * can legitimately have canvas corners that fall off the world, and there are
 * no tiles out there to ask for.
 *
 * @param {{scale: number, offsetX: number, offsetY: number}} fit
 * @param {number} width - CSS pixels
 * @param {number} height
 * @returns {{x0: number, y0: number, x1: number, y1: number}} normalised Mercator
 */
export function viewBoundsOf(fit, width, height) {
  const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
  return {
    x0: clamp01(-fit.offsetX / fit.scale),
    y0: clamp01(-fit.offsetY / fit.scale),
    x1: clamp01((width - fit.offsetX) / fit.scale),
    y1: clamp01((height - fit.offsetY) / fit.scale),
  }
}
