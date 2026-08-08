// XML -> RawTrackpoint[]. Pure field mapping, no domain logic (pauses,
// distance monotonicity, smoothing — all of that is normalizeActivity's
// job). See ARCHITECTURE.md §8 for the parsing gotchas this encodes.
//
// The private helpers below are deliberately duplicated from parseTcx.js
// rather than extracted into a shared module — parseFit does the same. Each
// adapter stays readable on its own, and a format-specific quirk in one can
// never silently change another.

const GPX_NAMESPACES = ['http://www.topografix.com/GPX/1/1', 'http://www.topografix.com/GPX/1/0']

// GPX has no sport field of its own; <trk><type> is free text every exporter
// fills in differently (Strava writes a bare activity-type number). Anything
// unrecognised — or absent, which is the norm for a satellite messenger or a
// camera's location log — is a plain GPS track.
const SPORT_BY_TRACK_TYPE = {
  run: 'running',
  running: 'running',
  jogging: 'running',
  bike: 'cycling',
  biking: 'cycling',
  cycling: 'cycling',
  cycle: 'cycling',
  ride: 'cycling',
}

function firstChildNS(parent, ns, localName) {
  return parent.getElementsByTagNameNS(ns, localName)[0] ?? null
}

// Descendant lookup is too loose for <trk>'s own metadata: <link> carries its
// own <type> (a MIME type) and would win a document-order search.
function directChildNS(parent, ns, localName) {
  for (const child of parent.children) {
    if (child.localName === localName && child.namespaceURI === ns) return child
  }
  return null
}

function trimmedTextOf(el) {
  const text = el?.textContent?.trim()
  return text ? text : null
}

function textOfNS(parent, ns, localName) {
  return trimmedTextOf(firstChildNS(parent, ns, localName))
}

function finiteOrNull(text) {
  if (text == null) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function parseTrackpoint(trkptEl, ns) {
  const timeText = textOfNS(trkptEl, ns, 'time')
  const time = timeText ? new Date(timeText) : null

  return {
    time,
    // GPX carries none of these: no distance, no speed, and no heart rate,
    // cadence or power (those live in a gpxtpx extension — see §12). The
    // pipeline reconstructs distance by haversine and speed from its deltas.
    distanceMeters: null,
    altitudeMeters: finiteOrNull(textOfNS(trkptEl, ns, 'ele')),
    heartRateBpm: null,
    cadenceSpm: null,
    watts: null,
    speedMps: null,
    // Position is an attribute pair here, not the child elements TCX uses.
    lat: finiteOrNull(trkptEl.getAttribute('lat')),
    lon: finiteOrNull(trkptEl.getAttribute('lon')),
  }
}

/**
 * @param {string} xmlText
 * @returns {{sport: import('../../domain/types.js').Sport, trackpoints: import('../../domain/types.js').RawTrackpoint[]}}
 */
export function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error("Couldn't read that file — it isn't valid XML")
  }

  // Resolved from the document rather than hardcoded: GPX 1.0 files are still
  // common from older loggers, and the two namespaces differ by one character.
  const root = doc.documentElement
  const ns = root?.namespaceURI
  if (root?.localName !== 'gpx' || !GPX_NAMESPACES.includes(ns)) {
    throw new Error("Couldn't find a GPX track in that file — is it a GPX export?")
  }

  const trkEl = firstChildNS(root, ns, 'trk')
  const trackType = trimmedTextOf(trkEl && directChildNS(trkEl, ns, 'type'))?.toLowerCase()
  const sport = SPORT_BY_TRACK_TYPE[trackType] ?? 'track'

  // Every trk > trkseg > trkpt flattened into one array, the same way
  // parseTcx flattens laps — segment boundaries are the recorder's own idea of
  // a dropout, which detectPauses re-derives from the timestamps anyway.
  const trkptEls = Array.from(root.getElementsByTagNameNS(ns, 'trkpt'))
  if (trkptEls.length === 0) {
    throw new Error("That GPX file doesn't contain any track points")
  }

  const trackpoints = trkptEls.map((el) => parseTrackpoint(el, ns)).filter((tp) => tp.time != null)

  // <time> is optional in GPX, unlike TCX and FIT — a route or waypoint export
  // is a perfectly valid GPX file with no timestamps anywhere. Nothing in a
  // timeseries view can be placed on an axis without one, so this gets its own
  // message rather than being reported as an empty file.
  if (trackpoints.length === 0) {
    throw new Error(
      "That GPX file has no timestamps — it looks like a route or waypoint list, not a recorded track",
    )
  }

  return { sport, trackpoints }
}
