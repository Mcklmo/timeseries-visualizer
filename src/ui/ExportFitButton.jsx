// Downloads the zoom window as a standalone .fit file. Rendered beside "Reset
// zoom", under the same rule: only while zoomed, because an unzoomed export is
// just the file the athlete already has.
//
// It is the one place that joins the three things an export needs — the window
// (ChartViewContext), the samples that window resolves to (StatsBasisContext)
// and the bytes it came from (ActivityContext's `ref`) — so data/fit/trimFit.js
// underneath it can stay a pure bytes-in/bytes-out function.
import { useCallback, useState } from 'react'
import { gunzipIfNeeded } from '../data/fileFormat.js'
import { trimFit } from '../data/fit/trimFit.js'
import { isFullDomain } from '../domain/zoomDomain.js'
import { downloadBytes } from '../lib/downloadBytes.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { useStatsBasis } from '../stats/StatsBasisContext.jsx'

const FIT_FILENAME = /\.fit(\.gz)?$/i

/**
 * Is this activity one we hold the original FIT bytes for?
 *
 * Deliberately a FILENAME test rather than a byte sniff, even though
 * data/fileFormat.js can sniff and the loader's fallback already does. This
 * question has to be answered synchronously, during render, to decide whether
 * the button exists at all — and reading the file to answer it cannot be. The
 * cost is a misnamed FIT (one the loader rescued by sniffing) getting no
 * button; that is the right trade, because a button that appears and then
 * errors is worse than one that never appears.
 *
 * Synced activities are excluded by construction: an `{type:'id'}` ref holds no
 * bytes, and Strava's route is normalized JSON streams rather than a file at
 * all.
 */
function isFitFileRef(ref) {
  return ref?.type === 'file' && FIT_FILENAME.test(ref.file.name)
}

/** `23870166877_ACTIVITY.fit` -> `23870166877_ACTIVITY-trimmed.fit` */
function trimmedFilenameFor(name) {
  return `${name.replace(FIT_FILENAME, '')}-trimmed.fit`
}

/** A Uint8Array's own bytes as an ArrayBuffer — gunzipIfNeeded's output can be
 *  a view into a larger buffer, and the FIT decoder reads whole buffers. */
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export function ExportFitButton() {
  const { activity, ref } = useActivity()
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
      // conversion from the zoom window back to the file's own wall clock.
      const samples = basis?.samples ?? []
      if (samples.length < 2) {
        throw new Error("That zoom window doesn't contain enough of this file to export")
      }
      const from = new Date(activity.startTime.getTime() + samples[0].t * 1000)
      const to = new Date(activity.startTime.getTime() + samples[samples.length - 1].t * 1000)

      // Inflated first, so a .fit.gz straight out of a bulk export works — the
      // same helper the intervals.icu download path goes through.
      const inflated = await gunzipIfNeeded(new Uint8Array(await ref.file.arrayBuffer()))
      const trimmed = await trimFit(toArrayBuffer(inflated), { from, to })

      downloadBytes(trimmed, trimmedFilenameFor(ref.file.name))
    } catch (err) {
      // Rendered inline beside the button rather than replacing the chart: the
      // activity on screen is still perfectly good, and a failed export is not
      // a reason to lose it.
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }, [activity, ref, basis])

  if (isFullDomain(zoomDomain) || !activity || !isFitFileRef(ref)) return null

  return (
    <>
      <button
        type="button"
        className="export-fit"
        onClick={onExport}
        disabled={busy}
        title="Download the zoomed window as its own .fit file"
      >
        {busy ? 'Exporting…' : 'Export'}
      </button>
      {error && (
        <span className="export-fit__error" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
