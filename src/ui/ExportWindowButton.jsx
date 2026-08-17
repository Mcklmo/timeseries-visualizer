// Downloads the zoom window as a standalone file, in the format it came from.
// Rendered beside "Reset zoom", under the same rule: only while zoomed, because
// an unzoomed export is just the file the athlete already has.
//
// It is the one place that joins the three things an export needs — the window
// (ChartViewContext), the samples that window resolves to (StatsBasisContext)
// and the file it came from (the ActivitySource, asked about ActivityContext's
// `ref`) — so the trimmers underneath it can stay pure text/bytes-in,
// text/bytes-out functions.
//
// **It reaches the file through the port, never through an adapter.** Whether a
// ref has a recorded original behind it, and how to fetch it, are both
// questions only the source can answer — a dropped `.tcx` is bytes already in
// hand, an intervals.icu activity is a second download. Asking
// `canExportWindow`/`readOriginalBytes` is what keeps this component from
// importing `intervalsApi`, which ARCHITECTURE.md §5 forbids.
//
// ⚠️ **This is the app's only network call that isn't a `load`.** An
// intervals.icu re-fetch can fail `unauthorized` (a key cleared in another
// tab), `rate_limited`, `network` or `no_original_file` — all four already have
// user-facing copy in intervalsApi.js:47-57, and all four render inline below
// unchanged, because IntervalsApiError propagates through the port untouched.
import { useCallback, useState } from 'react'
import { useActivitySource } from '../data/ActivitySource.js'
import { stripActivityExtension } from '../data/activityFilename.js'
import { trimActivityFile } from '../data/trimActivityFile.js'
import { isFullDomain } from '../domain/zoomDomain.js'
import { downloadBytes } from '../lib/downloadBytes.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { useStatsBasis } from '../stats/StatsBasisContext.jsx'

/** Long enough to stay recognisable, short enough for any filesystem. */
const MAX_SLUG_LENGTH = 60

/** A provider's activity title as a filename fragment. */
function slug(name) {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
}

/**
 * What to call the download.
 *
 * The extension comes from what the trim actually produced rather than from the
 * ref, because for a synced activity the ref does not know: there is no server
 * filename to read (Content-Disposition is unreadable across that CORS
 * boundary — fileFormat.js:9-13) and the format is only settled once the bytes
 * arrive.
 *
 * `ref.name` is optional and often absent — a stub picker row carries none — so
 * the provider-and-id fallback is a live path rather than dead code.
 *
 * Exported for its own unit tests; `statCheckboxLabel` sets that precedent.
 *
 * @param {import('../data/ActivitySource.js').ActivityRef} ref
 * @param {'fit'|'tcx'|'gpx'} extension
 */
export function trimmedFilenameFor(ref, extension) {
  if (ref?.type === 'file') {
    // stripActivityExtension takes a trailing `.gz` with it, so a
    // `run.fit.gz` becomes `run-trimmed.fit` — the trimmed file is not gzipped.
    return `${stripActivityExtension(ref.file.name)}-trimmed.${extension}`
  }
  return `${slug(ref?.name) || `${ref?.provider}-${ref?.id}`}-trimmed.${extension}`
}

export function ExportWindowButton() {
  const { activity, ref } = useActivity()
  const source = useActivitySource()
  const { zoomDomain } = useChartView()
  const { basis } = useStatsBasis()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const onExport = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // THE WINDOW, taken from the stats basis rather than re-sliced here. That
      // buys an invariant worth having: what you download is exactly what the
      // stat chips describe. (basis is useDeferredValue-lagged behind a live
      // gesture, which is invisible to a click — the fingers have stopped.)
      //
      // normalizeActivity sets startTime to the first usable trackpoint's time
      // and each sample.t to seconds since it, so this one line is the whole
      // conversion from the zoom window back to the file's own wall clock —
      // and it is the same line for all three formats.
      const samples = basis?.samples ?? []
      if (samples.length < 2) {
        throw new Error("That zoom window doesn't contain enough of this file to export")
      }
      const from = new Date(activity.startTime.getTime() + samples[0].t * 1000)
      const to = new Date(activity.startTime.getTime() + samples[samples.length - 1].t * 1000)

      // Inflated by the source, which is also where a `.fit.gz` straight out of
      // a bulk export and an intervals.icu gzip download stop being different
      // cases. The format is then decided by the bytes, not by this component.
      const original = await source.readOriginalBytes(ref)
      const { bytes, extension } = await trimActivityFile(original, { from, to })

      downloadBytes(bytes, trimmedFilenameFor(ref, extension))
    } catch (err) {
      // Rendered inline beside the button rather than replacing the chart: the
      // activity on screen is still perfectly good, and a failed export is not
      // a reason to lose it.
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }, [activity, ref, basis, source])

  /*
   * THE GATE, and it is deliberately synchronous.
   *
   * The source answers from the ref alone — a filename for a dropped file, a
   * provider for a synced one — never from the bytes, even though
   * data/fileFormat.js can sniff them and the loader's fallback already does.
   * This question has to be answered during render, to decide whether the
   * button exists at all, and reading a file to answer it cannot be. The cost
   * is a misnamed FIT (one the loader rescued by sniffing) getting no button;
   * that is the right trade, because a button that appears and then errors is
   * worse than one that never appears.
   *
   * intervals.icu is the deliberate exception: it always says yes, because the
   * format of the original upload is unknowable until the download lands, so
   * the failure it is trading against cannot be avoided by waiting. Even there
   * the error path is close to unreachable — `unsupportedReason`
   * (data/intervals/toActivityRow.js:27-42) greys out picker rows with no
   * usable original, so an activity that is on screen loaded from a file that
   * already parsed once.
   *
   * `?.` and `?? false` are load-bearing: the port's two export methods are
   * optional, and the UI suites are full of `{kind:'mock', load}` doubles that
   * implement neither. A source that does not answer cannot export.
   */
  if (isFullDomain(zoomDomain) || !activity || !(source.canExportWindow?.(ref) ?? false)) return null

  return (
    <>
      <button
        type="button"
        className="export-window"
        onClick={onExport}
        disabled={busy}
        title="Download the zoomed window as its own file"
      >
        {busy ? 'Exporting…' : 'Export'}
      </button>
      {error && (
        <span className="export-window__error" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
