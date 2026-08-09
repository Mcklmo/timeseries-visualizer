// Which raster tiles cover the map panel, and where each one lands on it.
// Pure arithmetic over the same normalised Web Mercator space the route is
// projected into (domain/webMercator.js) — no fetching, no canvas.
//
// The slippy-map scheme every raster provider uses: at zoom z the world is a
// 2^z × 2^z grid of `tileSize`-pixel tiles, numbered from the top-left, x
// eastward and y southward. That is exactly the unit square scaled by 2^z,
// which is why webMercator.js normalises to [0,1] and why its y runs north to
// south — both choices exist so that this file is arithmetic rather than a
// coordinate-system conversion.

/**
 * The zoom level whose tiles best match the fit already computed.
 *
 * Takes the fit's `scale` — the width in CSS pixels the whole world would have
 * under the current transform — rather than re-deriving it from bounds and a
 * panel size. map/fitBounds.js owns that arithmetic, and a second copy of it
 * here would be free to disagree, which would show up as tiles that are subtly
 * the wrong resolution rather than as an error.
 *
 * Rounded, not floored. Floor guarantees tiles are never downscaled, at the
 * cost of drawing them at up to 2× magnification — visibly soft, and softest
 * exactly at the sizes this panel uses. Round is at most 1.41× either way and
 * costs at most 4× the tile count at the crossover, which on a panel this size
 * is single digits of tiles.
 *
 * @param {number} scale - world width in CSS pixels (fitBounds' `fit.scale`)
 * @param {number} tileSize
 * @param {number} maxZoom - the deepest level the provider serves
 * @returns {number} an integer in [0, maxZoom]
 */
export function tileZoomFor(scale, tileSize, maxZoom) {
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(tileSize) || tileSize <= 0) return 0
  const ideal = Math.log2(scale / tileSize)
  if (!Number.isFinite(ideal)) return 0
  return Math.min(maxZoom, Math.max(0, Math.round(ideal)))
}

/**
 * Every tile overlapping a normalised-Mercator rect.
 *
 * Feed this the VIEW bounds (map/fitBounds.js's `viewBoundsOf`), not the
 * route's own bounds: the canvas shows the padding and whatever slack the
 * non-binding axis was left with, and unpainted panel around the edges of the
 * map is the bug that follows from getting this wrong.
 *
 * @param {{x0: number, y0: number, x1: number, y1: number}} bounds - [0,1]
 * @param {number} z
 * @returns {{z: number, x: number, y: number}[]} row-major, so tiles arrive in
 *   roughly the order they are read — which is also the order they finish
 *   downloading and therefore the order they appear
 */
export function tilesCovering(bounds, z) {
  const n = 2 ** z
  // The world wraps in x and does not in y, but neither matters here: the
  // caller has already clamped the view into [0,1], and at n-1 the `min` below
  // is what keeps a bound of exactly 1.0 from asking for tile number n — a
  // 404 on every provider, on every route that reaches the antimeridian or the
  // Mercator cutoff.
  const clampTile = (v) => Math.min(n - 1, Math.max(0, Math.floor(v * n)))

  const tx0 = clampTile(bounds.x0)
  const tx1 = clampTile(bounds.x1)
  const ty0 = clampTile(bounds.y0)
  const ty1 = clampTile(bounds.y1)

  const tiles = []
  for (let y = ty0; y <= ty1; y += 1) {
    for (let x = tx0; x <= tx1; x += 1) tiles.push({ z, x, y })
  }
  return tiles
}

/**
 * Where a tile lands on the canvas, through the same fit the route uses.
 *
 * A tile at (z, x, y) covers exactly `[x/n, (x+1)/n] × [y/n, (y+1)/n]` of the
 * unit square, so its position and size are the fit applied to that — which is
 * the whole reason the projection is normalised.
 *
 * @param {{z: number, x: number, y: number}} tile
 * @param {{scale: number, offsetX: number, offsetY: number}} fit
 * @returns {{x: number, y: number, size: number}} CSS pixels
 */
export function tileRect(tile, fit) {
  const n = 2 ** tile.z
  const size = fit.scale / n
  return {
    x: (tile.x / n) * fit.scale + fit.offsetX,
    y: (tile.y / n) * fit.scale + fit.offsetY,
    size,
  }
}

/** The cache/dedupe key for one tile of one provider. */
export function tileKey(provider, { z, x, y }) {
  return `${provider}/${z}/${x}/${y}`
}
