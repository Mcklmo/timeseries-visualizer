// Cumulative-metres axis, enforced monotonic. See ARCHITECTURE.md §8:
// <DistanceMeters> can be missing, non-monotonic, or reset — this is the
// one place that gets fixed up before anything downstream sees distance.

const EARTH_RADIUS_M = 6371000

function toRad(deg) {
  return (deg * Math.PI) / 180
}

/** Great-circle distance between two lat/lon points, in metres. */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * @param {{distanceMeters?: number|null, lat?: number|null, lon?: number|null}[]} trackpoints
 * @returns {number[]} cumulative metres, one per trackpoint, monotonically non-decreasing
 */
export function buildDistanceAxis(trackpoints) {
  const hasAnyDistance = trackpoints.some((tp) => tp.distanceMeters != null)

  if (hasAnyDistance) {
    let prev = 0
    return trackpoints.map((tp) => {
      if (tp.distanceMeters == null) return prev // hold forward through a gap
      prev = Math.max(prev, tp.distanceMeters) // clamp any decrease/reset
      return prev
    })
  }

  // No DistanceMeters anywhere in the file — reconstruct from GPS.
  let cumulative = 0
  let prevLat = null
  let prevLon = null
  return trackpoints.map((tp) => {
    if (tp.lat != null && tp.lon != null) {
      if (prevLat != null) cumulative += haversineMeters(prevLat, prevLon, tp.lat, tp.lon)
      prevLat = tp.lat
      prevLon = tp.lon
    }
    return cumulative
  })
}
