// A stable identity for an activity, derived from its own normalized content.
//
// The app had no such thing until this file existed. `Activity.id` used to be
// whatever the parser happened to have lying around — `fit-${Date.now()}` for
// FIT (a *different* id every time the same file is opened), the `<trk><name>`
// text for GPX (not unique, and empty in most exports), the `<Id>` timestamp
// for TCX — and nothing downstream consumed it, so nothing ever noticed. The
// moment anything wants to remember a per-activity choice across loads (see
// state/viewPrefsStore.js), that stops being harmless: a key that changes on
// every load remembers nothing, and a key that collides remembers the wrong
// thing.
//
// So `id` is now *this*, computed in normalizeActivity, and the parsers no
// longer emit one at all. The prefix is human-readable on purpose — this ends
// up as a visible sessionStorage key, and "which activity is this?" should be
// answerable from DevTools without decoding anything.
//
//   running-20260807T0712Z-3847s-3f2a9c1b
//
// The readable part is minute-resolution and the sport is not unique, so the
// hash is what actually separates two activities; the prefix is a label.
//
// WHAT GOES IN, AND WHY THIS SET: every input derives from the file's own
// bytes, so the same activity produces the same key whether the file was
// dropped in or downloaded from intervals.icu — which is the entire point,
// since IntervalsActivitySource reuses these same three parsers on that same
// original file.
//
// Deliberately excluded:
//   - `name` — intervals.icu overrides it *after* normalizeActivity returns
//     (IntervalsActivitySource.load), so including it would fork the key
//     between the two ingestion paths, breaking exactly the guarantee above.
//   - the parser-supplied ids — see the FIT `Date.now()` case above.
//
// Not a cryptographic hash and not trying to be: FNV-1a 32-bit is a few lines,
// synchronous (SubtleCrypto is not), dependency-free, and the collision domain
// is one browser tab's worth of activities.
//
// Total, like everything else in domain/: an invalid or missing startTime
// yields a usable key rather than a throw. That is not theoretical — a
// trackpoint whose timestamp text doesn't parse becomes an Invalid Date, which
// survives the parsers' `time != null` filter and reaches here, and
// `toISOString()` throws on one.

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** @param {string} input @returns {string} eight lowercase hex digits */
function fnv1a32(input) {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    // Math.imul, not `*`: the 32-bit product overflows a double's 53-bit
    // mantissa and the low bits — the ones that do the mixing — round away.
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** The full-precision ISO string, or null when there is no usable instant. */
function isoOf(startTime) {
  const ms = startTime instanceof Date ? startTime.getTime() : NaN
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * Content fingerprint for a normalized activity. Same content, same key.
 *
 * @param {{sport?: string, startTime?: Date, totalTime?: number, totalDistance?: number,
 *          samples?: unknown[], availableMetrics?: string[]}} activity
 * @returns {string}
 */
export function activityKeyOf({ sport, startTime, totalTime, totalDistance, samples, availableMetrics } = {}) {
  const iso = isoOf(startTime)

  // Seconds and metres are rounded so that float noise in the derived totals
  // (buildDistanceAxis sums haversine hops) can't fork the key for a file that
  // is byte-identical to one seen before.
  const canonical = [
    sport ?? '',
    iso ?? '',
    Math.round(Number(totalTime) || 0),
    Math.round(Number(totalDistance) || 0),
    Array.isArray(samples) ? samples.length : 0,
    Array.isArray(availableMetrics) ? availableMetrics.join(',') : '',
  ].join('|')

  // Minute resolution: enough to recognise the activity by eye, and the full
  // ISO is in the hash above, so two starts a second apart still differ.
  const stamp = iso ? `${iso.slice(0, 16).replace(/[-:]/g, '')}Z` : '00000000T0000Z'
  const label = String(sport ?? '').toLowerCase().replace(/[^a-z]/g, '') || 'activity'

  return `${label}-${stamp}-${Math.round(Number(totalTime) || 0)}s-${fnv1a32(canonical)}`
}
