// GPX -> GPX: keep only the track points inside a wall-clock window. The other
// direction of parseGpx.js, which is why it lives beside it — exactly the
// relationship trimFit.js has to parseFit.js.
//
// **Text in, text out**, mirroring `parseGpx(xmlText)`. The bytes <-> text
// codec lives once in data/trimActivityFile.js rather than being repeated in
// each trimmer, so nothing here has an opinion about encodings.
//
// Nothing here knows about Activity, samples or the zoom — a string and two
// Dates in, a string out. ui/ExportWindowButton.jsx is what turns the zoom
// window into that pair of Dates.
//
// **There is no distance rebase here, and its absence is deliberate.**
// trimFit.js:266-275 and trimTcx.js both re-base a cumulative distance channel
// to 0, or the trimmed file opens at 1481 m and reports twice the distance it
// holds. GPX carries no distance at all (parseGpx.js:60-64 — the pipeline
// reconstructs it by haversine from the positions), so a GPX window is correct
// the moment the points outside it are gone. A reader arriving from trimTcx
// will come looking for the rebase; this paragraph is why they will not find
// one.

const GPX_NAMESPACES = ['http://www.topografix.com/GPX/1/1', 'http://www.topografix.com/GPX/1/0']

// ⚠️ XMLSerializer DROPS the XML declaration — verified in this repo's jsdom:
//
//   in : <?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="…/GPX/1/1">…</gpx>
//   out: <gpx xmlns="http://www.topografix.com/GPX/1/1">…</gpx>
//
// So it is re-prepended by hand, and the declared encoding has to match the
// UTF-8 TextEncoder in trimActivityFile.js. Not cosmetic: some importers reject
// a prolog-less file. And a regression here would be invisible to the app's own
// sniff — detectActivityFormat strips an optional prolog (fileFormat.js:75-89),
// so the round trip would keep working right up until an external tool saw it.
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n'

const TEXT_NODE = 3

function directChildNS(parent, ns, localName) {
  for (const child of parent.children) {
    if (child.localName === localName && child.namespaceURI === ns) return child
  }
  return null
}

function textOfNS(parent, ns, localName) {
  const text = parent.getElementsByTagNameNS(ns, localName)[0]?.textContent?.trim()
  return text ? text : null
}

/**
 * Removing an element on its own leaves the newline and spaces that indented
 * it, so a trimmed file accumulates one blank ragged line per dropped point.
 * Taking the whitespace-only text sibling in front of it with it costs nothing
 * and keeps both the output and the fixture diffs readable.
 */
function removeWithIndentation(el) {
  const previous = el.previousSibling
  if (previous?.nodeType === TEXT_NODE && previous.data.trim() === '') previous.remove()
  el.remove()
}

/** Milliseconds, or null for a point that cannot be placed on the clock. */
function timeMsOf(trkptEl, ns) {
  const text = textOfNS(trkptEl, ns, 'time')
  if (text == null) return null
  const ms = new Date(text).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Trim a GPX file to a wall-clock window.
 *
 * @param {string} xmlText - the original GPX document
 * @param {{from: Date, to: Date}} window - inclusive at both ends, in the
 *   file's own wall clock
 * @returns {string} the trimmed document, XML declaration included
 */
export function trimGpx(xmlText, { from, to }) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error("Couldn't read that file — it isn't valid XML")
  }

  // Resolved from the document rather than hardcoded, for parseGpx.js:87-92's
  // reason: GPX 1.0 files are still common from older loggers, the two
  // namespaces differ by one character, and writing elements into the wrong one
  // produces a file this app's own reader would then reject. Same guard, same
  // message — a file that cannot be read cannot be trimmed either.
  const root = doc.documentElement
  const ns = root?.namespaceURI
  if (root?.localName !== 'gpx' || !GPX_NAMESPACES.includes(ns)) {
    throw new Error("Couldn't find a GPX track in that file — is it a GPX export?")
  }

  const fromMs = from.getTime()
  const toMs = to.getTime()

  // Array.from first: getElementsByTagNameNS is a LIVE collection, and removing
  // from it while iterating skips every other match.
  let kept = 0
  let firstKeptTimeText = null
  for (const trkptEl of Array.from(root.getElementsByTagNameNS(ns, 'trkpt'))) {
    const ms = timeMsOf(trkptEl, ns)
    // A point with no parseable <time> is dropped rather than guessed at: it
    // cannot be placed inside or outside the window, and parseGpx.js:106 drops
    // it on the way in anyway. trimFit.js:43-46 states the rule.
    if (ms == null || ms < fromMs || ms > toMs) {
      removeWithIndentation(trkptEl)
      continue
    }
    if (firstKeptTimeText == null) firstKeptTimeText = textOfNS(trkptEl, ns, 'time')
    kept++
  }

  if (kept < 2) {
    // Same sentence trimFit.js:263 throws, because it is the same situation and
    // the athlete has no way of telling the two apart.
    throw new Error("That zoom window doesn't contain enough of this file to export")
  }

  // Containers the trim emptied. A <trkseg> with no points is a segment that no
  // longer happened, and a <trk> whose segments are all gone is a track that no
  // longer happened — leaving either behind would have the file describe a
  // recording it does not contain.
  for (const trksegEl of Array.from(root.getElementsByTagNameNS(ns, 'trkseg'))) {
    if (trksegEl.getElementsByTagNameNS(ns, 'trkpt').length === 0) removeWithIndentation(trksegEl)
  }
  for (const trkEl of Array.from(root.getElementsByTagNameNS(ns, 'trk'))) {
    if (trkEl.getElementsByTagNameNS(ns, 'trkseg').length === 0) removeWithIndentation(trkEl)
  }

  // <metadata><time> is where every exporter writes the activity's start
  // instant (fixtures/activity_23870166877.gpx:6-8 does), so leaving the
  // parent's value has the trimmed file claim to begin before its own first
  // point. Updated ONLY where the element already exists — creating one would
  // be this module inventing metadata the recorder never wrote.
  const metadataEl = directChildNS(root, ns, 'metadata')
  const metadataTimeEl = metadataEl && directChildNS(metadataEl, ns, 'time')
  if (metadataTimeEl && firstKeptTimeText) metadataTimeEl.textContent = firstKeptTimeText

  // <wpt>, <rte> and <trk><name> are left exactly as they were: those are the
  // athlete's own annotations, not part of the recording, and a window of a
  // track does not make its name or its saved waypoints untrue.
  return XML_DECLARATION + new XMLSerializer().serializeToString(doc)
}
