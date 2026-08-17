// The one filename question this app asks: "is this the name of a recording we
// hold the original bytes for, and what should the trimmed copy be called?"
//
// Deliberately separate from fileFormat.js, whose header is emphatic that **the
// bytes decide, not the name**. That is still true of every READ. This module
// exists because the export path has one question the bytes cannot answer in
// time: whether the button exists at all is decided during render, and reading
// a file to answer it cannot be synchronous. See ExportWindowButton.jsx for the
// full argument.
//
// ⚠️ **`.fit.gz` is why this is one regex rather than a lookup by extension.**
// sourceRegistry's SOURCE_BY_EXTENSION is `{'.fit','.gpx','.tcx'}` with no
// `.fit.gz` in it — a gzipped file gets no adapter by name and is rescued by
// sniffing instead. Routing the export gate through that table would silently
// take the button away from a `.fit.gz` that has always had one. Matching an
// optional trailing `.gz` here, in the single place both the gate and the
// filename builder read, is what keeps the two from disagreeing.

const ACTIVITY_FILENAME = /\.(fit|tcx|gpx)(\.gz)?$/i

/**
 * @param {string} filename
 * @returns {'fit'|'tcx'|'gpx'|null} null means "not a name we can export from"
 */
export function activityExtensionOf(filename) {
  const match = ACTIVITY_FILENAME.exec(filename ?? '')
  return match ? /** @type {'fit'|'tcx'|'gpx'} */ (match[1].toLowerCase()) : null
}

/**
 * `23870166877_ACTIVITY.fit.gz` -> `23870166877_ACTIVITY`. The stem a trimmed
 * download is named after; the extension it gets back is whatever the trim
 * actually produced, which for an id ref is the only thing that knows.
 *
 * @param {string} filename
 * @returns {string}
 */
export function stripActivityExtension(filename) {
  return (filename ?? '').replace(ACTIVITY_FILENAME, '')
}
