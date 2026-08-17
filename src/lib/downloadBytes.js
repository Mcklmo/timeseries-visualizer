// Hand a byte array to the browser as a file download. The app's first and
// only download path — everything until now has been read-only.
//
// It lives in lib/ for the same reason feedbackClient.js does: it is a thin
// wrapper over a browser API that the rest of the app should not have to know
// the shape of. Nothing here is FIT-specific.

/**
 * @param {Uint8Array} bytes
 * @param {string} filename - what the file lands in Downloads as
 */
export function downloadBytes(bytes, filename) {
  // `application/octet-stream` rather than a FIT-ish type on purpose: this
  // helper is format-agnostic, and a generic binary type is what stops a
  // browser from trying to render or rewrite the payload.
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)

  // A detached anchor, never inserted into the document. Appending it would be
  // a visible DOM mutation in the middle of a chart render for no gain —
  // click() dispatches on a detached element just as well, and every browser
  // this app supports honours `download` there.
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()

  // Revoked immediately: the click has already handed the blob to the download
  // manager, which holds its own reference. Leaving the URL alive pins the
  // whole file in memory for the rest of the session.
  URL.revokeObjectURL(url)
}
