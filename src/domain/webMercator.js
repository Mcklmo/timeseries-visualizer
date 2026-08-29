// Spherical Web Mercator (EPSG:3857), normalised to the unit square. Pure
// arithmetic — no canvas, no DOM, no pixels; ui/../map/fitBounds.js is what
// turns a [0,1] pair into a position on a canvas.
//
// WHY THIS PROJECTION AND NOT A SIMPLER ONE. Plotting lat/lon straight onto x/y
// (plate carrée) is one line shorter and wrong in a way that is easy to miss on
// a screenshot and impossible to unsee afterwards: it stretches the map
// east-west by 1/cos(latitude), so a square block in Copenhagen renders about
// 1.8× wider than tall and every out-and-back loop comes out lopsided. Mercator
// is also the projection every raster tile scheme in existence is cut to
// (map/tileMath.js), so choosing anything else here would mean reprojecting
// tiles per pixel — which is exactly the per-frame work the fixed-fit design
// exists to avoid.
//
// NORMALISED TO [0,1], NOT TO METRES OR TO A ZOOM LEVEL. The unit square is the
// one coordinate space both consumers already want: a tile at zoom z covers
// exactly 1/2^z of it on each side, and the fit transform is then a single
// scale + translate. Emitting EPSG:3857 metres (±20037508.34) would need that
// same division back out again at every use site.

/**
 * The latitude Web Mercator is defined up to.
 *
 * Not a taste decision and not a rounding of 85: it is the latitude at which
 * the projection's y reaches exactly 1 world-width from the equator, which is
 * what makes the world a SQUARE and therefore what makes a tile pyramid
 * possible at all. y diverges to infinity at the poles, so there is no
 * "unclamped" version of this to be more correct than.
 *
 * A GPS fix cannot legitimately exceed it (no land, and no consumer device
 * ships there), but a corrupt file can, and a NaN/Infinity y would poison
 * `bounds` for the whole track — see buildTrack.js.
 */
export const MAX_LATITUDE = 85.05112878

const DEG_TO_RAD = Math.PI / 180

/**
 * lat/lon in degrees -> normalised Web Mercator, x and y both in [0,1].
 *
 * x runs west to east (0 at 180°W), y runs NORTH to SOUTH (0 at the top) —
 * screen order, deliberately, so neither the tile grid nor the canvas transform
 * has to carry a sign flip. That is also the order slippy-map tile y is
 * numbered in.
 *
 * @param {number} lat degrees, clamped to ±MAX_LATITUDE
 * @param {number} lon degrees
 * @returns {{x: number, y: number}}
 */
export function projectLatLon(lat, lon) {
  const clamped = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat))
  const phi = clamped * DEG_TO_RAD

  // ln(tan φ + sec φ) is the inverse Gudermannian, i.e. the Mercator northing.
  // Written this way rather than as the equivalent ln(tan(π/4 + φ/2)) because
  // that form loses precision near the equator, where tan(π/4 + φ/2) → 1 and
  // the logarithm of a number near 1 is where the significant digits go.
  const y = (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2

  return { x: (lon + 180) / 360, y }
}

/**
 * The inverse: normalised Web Mercator [0,1] back to lat/lon in degrees.
 *
 * Exists because `Track` is the only place an in-memory Activity keeps
 * positions — pre-projected, per buildTrack.js — while everything that leaves
 * the app (a share payload, and any future geo export) speaks lat/lon.
 *
 * atan(sinh(·)) is the Gudermannian, the exact inverse of the northing above;
 * round-tripping through projectLatLon is identity to double precision for any
 * latitude inside ±MAX_LATITUDE (the projection clamps outside, so the inverse
 * cannot recover what the forward direction already discarded).
 *
 * @param {number} x normalised easting in [0,1]
 * @param {number} y normalised northing in [0,1], NORTH to SOUTH
 * @returns {{lat: number, lon: number}} degrees
 */
export function unprojectXY(x, y) {
  return {
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEG_TO_RAD,
    lon: x * 360 - 180,
  }
}
