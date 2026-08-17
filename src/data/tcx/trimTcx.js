// TCX -> TCX: keep only the trackpoints inside a wall-clock window and rewrite
// the lap summaries so the result stands alone as its own activity. The other
// direction of parseTcx.js, which is why it lives beside it — the same
// relationship trimFit.js has to parseFit.js, and the same job.
//
// **Text in, text out**, mirroring `parseTcx(xmlText)`. The bytes <-> text
// codec lives once in data/trimActivityFile.js rather than in each trimmer.
//
// Nothing here knows about Activity, samples or the zoom — a string and two
// Dates in, a string out. ui/ExportWindowButton.jsx is what turns the zoom
// window into that pair of Dates.
//
// ## Why this edits the document instead of building a new one
//
// `ActivityLap_t` in TrainingCenterDatabasev2.xsd is an **xsd:sequence**:
// element ORDER is validity-relevant, and a lap whose children are in the wrong
// order is a file Garmin Connect rejects on upload. Overwriting existing
// elements' text in place is order-preserving for free. So the rule throughout
// is:
//
//   - **overwrite** an element's text where the kept trackpoints can derive it,
//   - **remove** an element whose channel the window no longer contains,
//   - **insert** only through LAP_CHILD_ORDER below, which places a new child in
//     front of the first existing sibling that sorts after it.
//
// That also sidesteps the ActivityLapExtension_t ordering question entirely:
// nothing is ever inserted into an <Extensions>, only overwritten or removed.

const TCX_NS = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'
const ACTIVITY_EXT_NS = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'

/**
 * `ActivityLap_t`'s xsd:sequence, in order. Verified against
 * fixtures/activity_23870166877.tcx:12-24, which writes elements 1-10 of it.
 *
 * Only used to place an element that has to exist and does not yet — the
 * schema-required ones on a lap some exporter wrote sparsely. Everything else
 * is overwritten where it stands.
 */
const LAP_CHILD_ORDER = [
  'TotalTimeSeconds',
  'DistanceMeters',
  'MaximumSpeed',
  'Calories',
  'AverageHeartRateBpm',
  'MaximumHeartRateBpm',
  'Intensity',
  'Cadence',
  'TriggerMethod',
  'Track',
  'Notes',
  'Extensions',
]

// ⚠️ XMLSerializer DROPS the XML declaration — verified in this repo's jsdom.
// See the identical note in gpx/trimGpx.js: it is re-prepended by hand, the
// declared encoding must match trimActivityFile.js's UTF-8 TextEncoder, and a
// regression would be invisible to detectActivityFormat (which strips an
// optional prolog, fileFormat.js:75-89) right up until an external importer
// rejected the file.
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n'

const TEXT_NODE = 3

/* ── DOM helpers ──────────────────────────────────────────────────────────── */

function directChildNS(parent, ns, localName) {
  for (const child of parent.children) {
    if (child.localName === localName && child.namespaceURI === ns) return child
  }
  return null
}

function trimmedText(el) {
  const text = el?.textContent?.trim()
  return text ? text : null
}

function finiteOrNull(text) {
  if (text == null) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** See gpx/trimGpx.js — removing an element alone leaves its indentation. */
function removeWithIndentation(el) {
  const previous = el.previousSibling
  if (previous?.nodeType === TEXT_NODE && previous.data.trim() === '') previous.remove()
  el.remove()
}

/** The whitespace an element indents its children by, for an inserted sibling. */
function innerIndentOf(parent) {
  for (const node of parent.childNodes) {
    if (node.nodeType === TEXT_NODE && node.data.trim() === '' && node.data.includes('\n')) return node.data
  }
  return null
}

/**
 * Places `el` at its schema position among `lapEl`'s children: in front of the
 * first existing sibling with a higher LAP_CHILD_ORDER index, or at the end.
 *
 * Anchoring on the whitespace node in front of that sibling rather than on the
 * sibling itself is what keeps the inserted element on its own line.
 */
function insertLapChild(lapEl, el) {
  const index = LAP_CHILD_ORDER.indexOf(el.localName)
  let anchor = null
  for (const child of lapEl.children) {
    if (LAP_CHILD_ORDER.indexOf(child.localName) > index) {
      anchor = child
      break
    }
  }
  const before = anchor ? anchor.previousSibling : lapEl.lastChild
  if (before?.nodeType === TEXT_NODE && before.data.trim() === '') anchor = before

  const indent = innerIndentOf(lapEl)
  if (indent) lapEl.insertBefore(lapEl.ownerDocument.createTextNode(indent), anchor)
  lapEl.insertBefore(el, anchor)
}

function ensureLapChild(lapEl, localName) {
  const existing = directChildNS(lapEl, TCX_NS, localName)
  if (existing) return existing
  const el = lapEl.ownerDocument.createElementNS(TCX_NS, localName)
  insertLapChild(lapEl, el)
  return el
}

/** Overwrite where derivable; remove where the window holds no such channel. */
function setOrRemoveLapChild(lapEl, localName, text) {
  if (text == null) {
    const existing = directChildNS(lapEl, TCX_NS, localName)
    if (existing) removeWithIndentation(existing)
    return
  }
  ensureLapChild(lapEl, localName).textContent = text
}

/** HeartRateInBeatsPerMinute_t wraps its number in a <Value> child. */
function setOrRemoveHeartRateChild(lapEl, localName, bpm) {
  if (bpm == null) {
    const existing = directChildNS(lapEl, TCX_NS, localName)
    if (existing) removeWithIndentation(existing)
    return
  }
  const el = ensureLapChild(lapEl, localName)
  const valueEl = directChildNS(el, TCX_NS, 'Value')
  if (valueEl) valueEl.textContent = String(bpm)
  else {
    const created = el.ownerDocument.createElementNS(TCX_NS, 'Value')
    created.textContent = String(bpm)
    el.replaceChildren(created)
  }
}

/* ── Numbers ──────────────────────────────────────────────────────────────── */

// Loops rather than Math.max(...values), for trimFit.js:78-79's reason: a long
// activity is tens of thousands of points and spreading that many arguments
// overflows the call stack.
function maxOf(values) {
  let max = -Infinity
  for (const value of values) if (value > max) max = value
  return max
}

function meanOf(values) {
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

/**
 * Text for a derived number. `toFixed(6)` then back through Number strips the
 * float artifacts a subtraction leaves (1622.8300000000002) at a precision no
 * recorded channel comes anywhere near — a micrometre, a microsecond.
 */
function formatNumber(value) {
  return String(Number(value.toFixed(6)))
}

/** Finite values only, so an absent channel never reaches maxOf as NaN. */
function collect(elements, read) {
  const out = []
  for (const el of elements) {
    const value = read(el)
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  }
  return out
}

/* ── Trackpoint field readers ─────────────────────────────────────────────── */

const timeTextOf = (tpEl) => trimmedText(directChildNS(tpEl, TCX_NS, 'Time'))

function timeMsOf(tpEl) {
  const text = timeTextOf(tpEl)
  if (text == null) return null
  const ms = new Date(text).getTime()
  return Number.isFinite(ms) ? ms : null
}

const numberOf = (tpEl, localName) => finiteOrNull(trimmedText(directChildNS(tpEl, TCX_NS, localName)))

function heartRateOf(tpEl) {
  const hrEl = directChildNS(tpEl, TCX_NS, 'HeartRateBpm')
  return hrEl ? finiteOrNull(trimmedText(directChildNS(hrEl, TCX_NS, 'Value'))) : null
}

function tpxNumberOf(tpEl, localName) {
  const extensionsEl = directChildNS(tpEl, TCX_NS, 'Extensions')
  const tpxEl = extensionsEl ? directChildNS(extensionsEl, ACTIVITY_EXT_NS, 'TPX') : null
  return tpxEl ? finiteOrNull(trimmedText(directChildNS(tpxEl, ACTIVITY_EXT_NS, localName))) : null
}

/* ── Lap rewriting ────────────────────────────────────────────────────────── */

/**
 * `ns3:LX` children this module can honestly re-derive from the kept
 * trackpoints. Anything else in there — `Steps` above all, which no trackpoint
 * field adds up to — is removed rather than carried, because a lap extension
 * describing the parent activity is the same lie as a session summary would be.
 *
 * @type {Record<string, (kept: Element[]) => number|null>}
 */
const LX_DERIVATIONS = {
  AvgSpeed: (kept) => meanOrNull(collect(kept, (tp) => tpxNumberOf(tp, 'Speed'))),
  MaxSpeed: (kept) => maxOrNull(collect(kept, (tp) => tpxNumberOf(tp, 'Speed'))),
  AvgWatts: (kept) => roundOrNull(meanOrNull(collect(kept, (tp) => tpxNumberOf(tp, 'Watts')))),
  MaxWatts: (kept) => maxOrNull(collect(kept, (tp) => tpxNumberOf(tp, 'Watts'))),
  AvgRunCadence: (kept) => roundOrNull(meanOrNull(collect(kept, (tp) => tpxNumberOf(tp, 'RunCadence')))),
  MaxRunCadence: (kept) => maxOrNull(collect(kept, (tp) => tpxNumberOf(tp, 'RunCadence'))),
  MaxBikeCadence: (kept) => maxOrNull(collect(kept, (tp) => numberOf(tp, 'Cadence'))),
}

const meanOrNull = (values) => (values.length > 0 ? meanOf(values) : null)
const maxOrNull = (values) => (values.length > 0 ? maxOf(values) : null)
const roundOrNull = (value) => (value == null ? null : Math.round(value))

/**
 * Rewrite one lap's summary from the trackpoints the window left in it.
 *
 * @param {Element} lapEl
 * @param {Element[]} kept - in document order, distances already re-based
 * @param {boolean} boundariesMoved - did the window drop any of this lap's points?
 */
function rewriteLap(lapEl, kept, boundariesMoved) {
  const first = kept[0]
  const last = kept[kept.length - 1]

  // Lap@StartTime is a REQUIRED xsd:dateTime. Carried as the source's own text
  // rather than reformatted from a Date, so the file keeps whatever precision
  // and offset its exporter wrote.
  const firstTimeText = timeTextOf(first)
  if (firstTimeText) lapEl.setAttribute('StartTime', firstTimeText)

  setOrRemoveLapChild(lapEl, 'TotalTimeSeconds', formatNumber((timeMsOf(last) - timeMsOf(first)) / 1000))

  // A difference between two kept trackpoints *within this lap*, which makes it
  // rebase-invariant — the same number before and after the subtraction below.
  const distances = collect(kept, (tp) => numberOf(tp, 'DistanceMeters'))
  const lapDistance = distances.length > 0 ? distances[distances.length - 1] - distances[0] : 0
  setOrRemoveLapChild(lapEl, 'DistanceMeters', formatNumber(lapDistance))

  const speeds = collect(kept, (tp) => tpxNumberOf(tp, 'Speed'))
  setOrRemoveLapChild(lapEl, 'MaximumSpeed', speeds.length > 0 ? formatNumber(maxOf(speeds)) : null)

  // ⚠️ <Calories> is REQUIRED by ActivityLap_t, so trimFit.js:205-209's rule —
  // omit rather than prorate, because a calorie count scaled by time is a
  // fabricated number that looks real — is simply not available here. The
  // schema will not let this element be absent.
  //
  // Of what remains: carrying the parent's 361 asserts a 30-minute run's
  // calories for a 10-minute slice, exactly the "summary its own records
  // contradict" failure trimFit.js:48-50 rejects; prorating to 120 is the
  // fabricated-but-plausible number setIfFinite (trimFit.js:98-107) exists to
  // prevent. `0` is what Garmin's and Strava's own TCX exporters write when the
  // device reported no figure, so in this format it reads as "not measured"
  // rather than as a claim — and nobody seeing 0 beside a 10-minute run
  // mistakes it for a measurement, which is precisely the property the prorated
  // number lacks. Nothing in this app reads <Calories>.
  setOrRemoveLapChild(lapEl, 'Calories', '0')

  const heartRates = collect(kept, heartRateOf)
  // TCX stores these as integers, so the mean is rounded here where the intent
  // is visible rather than truncated by whatever reads the file.
  setOrRemoveHeartRateChild(lapEl, 'AverageHeartRateBpm', heartRates.length > 0 ? Math.round(meanOf(heartRates)) : null)
  setOrRemoveHeartRateChild(lapEl, 'MaximumHeartRateBpm', heartRates.length > 0 ? maxOf(heartRates) : null)

  // Required, and not derivable from trackpoints at all — it is the athlete's
  // own classification of the lap, which a window of it does not change.
  setOrRemoveLapChild(lapEl, 'Intensity', trimmedText(directChildNS(lapEl, TCX_NS, 'Intensity')) ?? 'Active')

  // The lap-level <Cadence> is CYCLING cadence in pedal rpm, matching the
  // top-level <Cadence> on a Trackpoint (parseTcx.js:44-53). Running cadence
  // does not live here — it is ns3:LX/AvgRunCadence, handled below.
  const cadences = collect(kept, (tp) => numberOf(tp, 'Cadence'))
  setOrRemoveLapChild(lapEl, 'Cadence', cadences.length > 0 ? String(Math.round(meanOf(cadences))) : null)

  // Required. `Manual` is the honest value for a lap this trim re-cut: whatever
  // the device's own trigger was — distance, time, a button press — it is not
  // what decided where this lap now begins and ends.
  const trigger = trimmedText(directChildNS(lapEl, TCX_NS, 'TriggerMethod'))
  setOrRemoveLapChild(lapEl, 'TriggerMethod', boundariesMoved ? 'Manual' : (trigger ?? 'Manual'))

  // Track_t requires minOccurs=1 Trackpoint, so a <Track> the window emptied is
  // INVALID rather than merely useless — it has to go.
  for (const trackEl of Array.from(lapEl.getElementsByTagNameNS(TCX_NS, 'Track'))) {
    if (trackEl.getElementsByTagNameNS(TCX_NS, 'Trackpoint').length === 0) removeWithIndentation(trackEl)
  }

  rewriteLapExtensions(lapEl, kept)

  // <Notes> is left exactly as it was: the athlete's own words about the lap,
  // the XML analogue of trimFit.js:25-39's copiedVerbatimMesgNums.
}

/** Overwrite what the kept points can derive, remove what they cannot, insert nothing. */
function rewriteLapExtensions(lapEl, kept) {
  const extensionsEl = directChildNS(lapEl, TCX_NS, 'Extensions')
  if (!extensionsEl) return
  const lxEl = directChildNS(extensionsEl, ACTIVITY_EXT_NS, 'LX')
  if (!lxEl) return

  for (const child of Array.from(lxEl.children)) {
    const derive = LX_DERIVATIONS[child.localName]
    const value = derive ? derive(kept) : null
    if (value == null) removeWithIndentation(child)
    else child.textContent = formatNumber(value)
  }

  // An emptied LX (or an Extensions holding nothing but one) describes a lap
  // that no longer has those measurements. Both go.
  if (lxEl.children.length === 0) removeWithIndentation(lxEl)
  if (extensionsEl.children.length === 0) removeWithIndentation(extensionsEl)
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

/**
 * Trim a TCX file to a wall-clock window.
 *
 * @param {string} xmlText - the original TCX document
 * @param {{from: Date, to: Date}} window - inclusive at both ends, in the
 *   file's own wall clock
 * @returns {string} the trimmed document, XML declaration included
 */
export function trimTcx(xmlText, { from, to }) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error("Couldn't read that file — it isn't valid XML")
  }

  const activityEls = Array.from(doc.getElementsByTagNameNS(TCX_NS, 'Activity'))
  const activityEl = activityEls[0]
  if (!activityEl) {
    // parseTcx.js:68-71's own message: a file that cannot be read cannot be
    // trimmed either, and the athlete gains nothing from a second wording.
    throw new Error("Couldn't find an Activity in that file — is it a TCX export?")
  }
  // A TCX may hold several activities; parseTcx.js:68 charts only the FIRST, so
  // that is the one on screen and the only one the zoom window means anything
  // about. Exporting the others alongside it would hand back activities the
  // window was never applied to.
  for (const el of activityEls.slice(1)) removeWithIndentation(el)

  const fromMs = from.getTime()
  const toMs = to.getTime()

  // Array.from first: getElementsByTagNameNS is a LIVE collection, and removing
  // from it while iterating skips every other match.
  const laps = []
  const allKept = []
  for (const lapEl of Array.from(activityEl.getElementsByTagNameNS(TCX_NS, 'Lap'))) {
    const tpEls = Array.from(lapEl.getElementsByTagNameNS(TCX_NS, 'Trackpoint'))
    const kept = []
    for (const tpEl of tpEls) {
      const ms = timeMsOf(tpEl)
      // A trackpoint with no <Time> is dropped rather than guessed at: it
      // cannot be placed inside or outside the window, and parseTcx.js:81 drops
      // it on the way in anyway. trimFit.js:43-46 states the rule.
      if (ms == null || ms < fromMs || ms > toMs) {
        removeWithIndentation(tpEl)
        continue
      }
      kept.push(tpEl)
    }
    laps.push({ lapEl, kept, boundariesMoved: kept.length !== tpEls.length })
    allKept.push(...kept)
  }

  if (allKept.length < 2) {
    // Same sentence trimFit.js:263 throws, and the same one that covers "the
    // window emptied every lap" — Activity_t requires minOccurs=1 Lap, so a
    // file with no laps left is unrepresentable, and it can only happen when
    // there were fewer than two points to begin with.
    throw new Error("That zoom window doesn't contain enough of this file to export")
  }

  // ⚠️ THE REBASE, and the same trap trimFit.js:266-275 documents. Garmin
  // writes Trackpoint/DistanceMeters cumulative from the ACTIVITY's start and
  // across lap boundaries, so a window at minute 10 opens at ~1481 m. Nothing
  // downstream subtracts it — domain/buildDistanceAxis.js reads the value
  // verbatim, and its monotonic clamp (buildDistanceAxis.js:31) means the read
  // path is already committed to "activity-cumulative" — so without this the
  // re-imported file reports roughly twice the true windowed distance, a wrong
  // number that looks entirely plausible.
  //
  // The base is the first kept trackpoint that HAS a distance, not necessarily
  // the first kept trackpoint, mirroring trimFit.js:272. Points with no
  // <DistanceMeters> are left without one; buildDistanceAxis.js:28-33 holds the
  // previous value forward for exactly that case.
  const base = collect(allKept, (tp) => numberOf(tp, 'DistanceMeters'))[0] ?? 0
  for (const tpEl of allKept) {
    const el = directChildNS(tpEl, TCX_NS, 'DistanceMeters')
    const value = finiteOrNull(trimmedText(el))
    if (value != null) el.textContent = formatNumber(value - base)
  }

  for (const { lapEl, kept, boundariesMoved } of laps) {
    if (kept.length === 0) removeWithIndentation(lapEl)
    else rewriteLap(lapEl, kept, boundariesMoved)
  }

  // <Id> is a required xsd:dateTime that parseTcx never reads — but Garmin
  // Connect dedupes uploads on it, so leaving the parent's value makes the
  // trimmed file claim to BE its parent and the upload silently does nothing.
  // Same class of decision as trimFit.js:286-289's absolute timestamps.
  const idEl = directChildNS(activityEl, TCX_NS, 'Id')
  const firstTimeText = timeTextOf(allKept[0])
  if (idEl && firstTimeText) idEl.textContent = firstTimeText

  // <Creator>, <Author>, <Folders> and the activity's own <Notes>/<Training>
  // pass through verbatim — who recorded this, on what. The XML analogue of
  // trimFit.js:25-39's copiedVerbatimMesgNums, and true of a window for exactly
  // the same reason it is true of the whole file.
  return XML_DECLARATION + new XMLSerializer().serializeToString(doc)
}
