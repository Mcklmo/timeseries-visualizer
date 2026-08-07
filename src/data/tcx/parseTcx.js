// XML -> RawTrackpoint[]. Pure field mapping, no domain logic (pauses,
// distance monotonicity, smoothing — all of that is normalizeActivity's
// job). See ARCHITECTURE.md §8 for the parsing gotchas this encodes.

const TCX_NS = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'
const ACTIVITY_EXT_NS = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'

const SPORT_BY_TCX_ATTR = { Running: 'running', Biking: 'cycling' }

function firstChildNS(parent, ns, localName) {
  return parent.getElementsByTagNameNS(ns, localName)[0] ?? null
}

function textOfNS(parent, ns, localName) {
  const el = firstChildNS(parent, ns, localName)
  const text = el?.textContent?.trim()
  return text ? text : null
}

function numberOfNS(parent, ns, localName) {
  const text = textOfNS(parent, ns, localName)
  return text == null ? null : Number(text)
}

function parseTrackpoint(tpEl, sport) {
  const timeText = textOfNS(tpEl, TCX_NS, 'Time')
  const time = timeText ? new Date(timeText) : null

  const distanceMeters = numberOfNS(tpEl, TCX_NS, 'DistanceMeters')
  const altitudeMeters = numberOfNS(tpEl, TCX_NS, 'AltitudeMeters')

  const hrEl = firstChildNS(tpEl, TCX_NS, 'HeartRateBpm')
  const heartRateBpm = hrEl ? numberOfNS(hrEl, TCX_NS, 'Value') : null

  const positionEl = firstChildNS(tpEl, TCX_NS, 'Position')
  const lat = positionEl ? numberOfNS(positionEl, TCX_NS, 'LatitudeDegrees') : null
  const lon = positionEl ? numberOfNS(positionEl, TCX_NS, 'LongitudeDegrees') : null

  const extensionsEl = firstChildNS(tpEl, TCX_NS, 'Extensions')
  const tpxEl = extensionsEl ? firstChildNS(extensionsEl, ACTIVITY_EXT_NS, 'TPX') : null
  const speedMps = tpxEl ? numberOfNS(tpxEl, ACTIVITY_EXT_NS, 'Speed') : null
  const watts = tpxEl ? numberOfNS(tpxEl, ACTIVITY_EXT_NS, 'Watts') : null

  // Running cadence lives in Extensions > TPX > RunCadence, in strides/min —
  // double it for steps/min. Cycling cadence lives in the plain top-level
  // <Cadence> element instead, already in pedal rpm — no doubling.
  let cadenceSpm = null
  if (sport === 'cycling') {
    cadenceSpm = numberOfNS(tpEl, TCX_NS, 'Cadence')
  } else {
    const runCadence = tpxEl ? numberOfNS(tpxEl, ACTIVITY_EXT_NS, 'RunCadence') : null
    cadenceSpm = runCadence == null ? null : runCadence * 2
  }

  return { time, distanceMeters, altitudeMeters, heartRateBpm, cadenceSpm, watts, speedMps, lat, lon }
}

/**
 * @param {string} xmlText
 * @returns {{id: string, sport: import('../../domain/types.js').Sport, trackpoints: import('../../domain/types.js').RawTrackpoint[]}}
 */
export function parseTcx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error("Couldn't read that file — it isn't valid XML")
  }

  const activityEl = firstChildNS(doc, TCX_NS, 'Activity')
  if (!activityEl) {
    throw new Error("Couldn't find an Activity in that file — is it a TCX export?")
  }

  const sportAttr = activityEl.getAttribute('Sport')
  const sport = SPORT_BY_TCX_ATTR[sportAttr]
  if (!sport) {
    throw new Error(`Only running and cycling activities are supported right now (this file is "${sportAttr ?? 'unknown'}")`)
  }

  const id = textOfNS(activityEl, TCX_NS, 'Id') ?? `tcx-${Date.now()}`

  const trackpoints = Array.from(activityEl.getElementsByTagNameNS(TCX_NS, 'Trackpoint'))
    .map((tpEl) => parseTrackpoint(tpEl, sport))
    .filter((tp) => tp.time != null) // a trackpoint with no timestamp can't be placed on any axis

  if (trackpoints.length === 0) {
    throw new Error("That TCX file doesn't contain any trackpoints")
  }

  return { id, sport, trackpoints }
}
