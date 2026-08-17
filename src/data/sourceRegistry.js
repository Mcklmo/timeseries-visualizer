// The composition root's dispatch table — ref in, adapter out. Lifted out of
// App.jsx, which owned four `new`s and a `sourceFor` before a second network
// provider made that the wrong place for them.
//
// **This is still the only place concrete adapters are instantiated** (see
// ARCHITECTURE.md §5). Nothing above `data/` imports an adapter; App.jsx calls
// `createDefaultSource()` bare and hands the result to ActivitySourceProvider,
// and the whole tree below talks to the ActivitySource shape.
//
// Two dispatch axes, and they are genuinely different questions:
//
//   - **A file ref dispatches on the filename extension, and falls back to
//     sniffing its bytes.** A recognised extension is trusted and costs
//     nothing: `.fit`, `.gpx` and `.tcx` route straight to their parser as they
//     always did. Anything else is read, gunzipped if it is gzipped, and put
//     through the same `fileFormat.js` the network path uses — which is what
//     makes a `.fit.gz` work instead of dying on "invalid XML" with the inflate
//     code sitting one directory away. Bytes that match nothing still fall
//     through to TcxActivitySource, so an unparseable file gets a real parser
//     error rather than a shrug — deliberate, and load-bearing in the tests.
//   - **An id ref dispatches on `ref.provider`, and never on the id itself.**
//     Strava ids and intervals.icu ids are both opaque strings; there is no
//     shape to tell them apart by. Before this file existed, `type === 'id'`
//     meant intervals.icu unconditionally.
//
// **An id ref with no provider throws.** Not "falls back to intervals.icu" —
// the failure mode of a wrong guess is issuing one athlete's credential
// against another service, or reading from an account the user did not pick.
// A loud throw at the boundary is the cheapest possible version of that bug.
//
// **Credentials are read through thunks, at load time, never captured here.**
// A Disconnect (or a key cleared in another tab) then takes effect on the very
// next load, where a value read while this module first evaluated would keep
// working long after the user revoked it. It also keeps a visitor who only
// ever drops files at zero requests and zero storage reads: constructing the
// registry touches neither. The defaults read the real app-wide stores so
// App.jsx can call this with no arguments, and tests inject their own —
// exactly the pattern credentialStore.js documents.
import { activityExtensionOf } from './activityFilename.js'
import { detectActivityFormat, gunzipIfNeeded } from './fileFormat.js'
import { FitActivitySource } from './fit/FitActivitySource.js'
import { GpxActivitySource } from './gpx/GpxActivitySource.js'
import { credentialStore } from './intervals/credentialStore.js'
import { IntervalsActivitySource } from './intervals/IntervalsActivitySource.js'
import { readFreshAccessToken } from './strava/stravaApi.js'
import { StravaActivitySource } from './strava/StravaActivitySource.js'
import { stravaStreamCache } from './strava/streamCache.js'
import { TcxActivitySource } from './tcx/TcxActivitySource.js'

/** @typedef {import('./ActivitySource.js').ActivityRef} ActivityRef */
/** @typedef {import('./ActivitySource.js').ActivitySource} ActivitySource */

/**
 * `getStravaAccessToken` is **async** where `getIntervalsApiKey` is not, and
 * that asymmetry is real rather than an inconsistency: an intervals.icu key is
 * a password that never expires, while a Strava access token lives six hours
 * and reading it may have to refresh it first.
 *
 * `stravaCache` is passed in rather than left to the adapter's own default for
 * one reason: **Disconnect has to be able to clear it.** A private cache inside
 * the adapter is unreachable from the UI, and a tab left open after the athlete
 * revokes their grant would go on holding their telemetry in memory — the one
 * part of API Policy §7.4 that cache evaporation cannot satisfy by itself.
 *
 * @param {{
 *   getIntervalsApiKey?: () => string|null,
 *   getStravaAccessToken?: () => Promise<string>,
 *   stravaCache?: import('./strava/streamCache.js').createStreamCache,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 * @returns {ActivitySource}
 */
export function createDefaultSource({
  getIntervalsApiKey = () => credentialStore.readApiKey(),
  getStravaAccessToken = () => readFreshAccessToken({ fetchImpl }),
  stravaCache = stravaStreamCache,
  fetchImpl,
} = {}) {
  const tcxSource = new TcxActivitySource()
  const fitSource = new FitActivitySource()
  const gpxSource = new GpxActivitySource()
  const intervalsSource = new IntervalsActivitySource({ getApiKey: getIntervalsApiKey, fetchImpl })
  const stravaSource = new StravaActivitySource({
    getAccessToken: getStravaAccessToken,
    cache: stravaCache,
    fetchImpl,
  })

  const SOURCE_BY_EXTENSION = { '.fit': fitSource, '.gpx': gpxSource, '.tcx': tcxSource }
  /** @type {Record<import('./ActivitySource.js').ActivityProvider, ActivitySource>} */
  const SOURCE_BY_PROVIDER = { intervals: intervalsSource, strava: stravaSource }

  /** @param {ActivityRef} ref */
  function sourceFor(ref) {
    if (ref?.type === 'id') {
      const source = SOURCE_BY_PROVIDER[ref.provider]
      if (!source) {
        // Never a fall-through. See the header: guessing loads from the wrong
        // account. The message names the value so a typo is obvious in the
        // console; ids and credentials are not in it.
        throw new Error(`No activity source for provider "${ref.provider}"`)
      }
      return source
    }
    if (ref?.type !== 'file') return tcxSource
    const name = ref.file.name.toLowerCase()
    const extension = Object.keys(SOURCE_BY_EXTENSION).find((ext) => name.endsWith(ext))
    return extension ? SOURCE_BY_EXTENSION[extension] : null
  }

  /**
   * The fallback for a file whose name told us nothing — `.fit.gz` straight out
   * of a bulk export, a `.xml` that is really a TCX, a file the OS renamed.
   *
   * Only reached when the extension is unrecognised, so the common path pays
   * nothing: a `.fit` is never read twice, and this function never runs for one.
   *
   * The inflated bytes are re-wrapped as a `File` rather than handed to the
   * parser directly, because that keeps every adapter's contract exactly as it
   * was — they take a `File`, and none of them needs to learn that some files
   * arrive pre-decompressed. The name is carried across so an error message
   * still names what the athlete dropped.
   *
   * `null` means "the bytes matched nothing either", and the caller then falls
   * through to TcxActivitySource so the athlete gets a real parser error rather
   * than a shrug.
   *
   * @param {import('./ActivitySource.js').FileActivityRef} ref
   * @returns {Promise<{source: ActivitySource, ref: ActivityRef}|null>}
   */
  /**
   * **The bytes ARE a file ref** — reading them needs no per-format knowledge
   * at all, which is why the export path handles file refs here rather than
   * fanning them out to three three-line adapters.
   * IntervalsActivitySource.js:12-16 already sets that precedent.
   *
   * Shared with `sniffFileRef` below, which opens with exactly this line: the
   * fallback loader and the export path both want "this file, inflated", and
   * two copies of it could come to disagree about the gunzip.
   *
   * @param {import('./ActivitySource.js').FileActivityRef} ref
   * @returns {Promise<Uint8Array>}
   */
  async function readFileBytes(ref) {
    return gunzipIfNeeded(new Uint8Array(await ref.file.arrayBuffer()))
  }

  async function sniffFileRef(ref) {
    let bytes
    try {
      bytes = await readFileBytes(ref)
    } catch {
      // A truncated or corrupt gzip stream. Nothing useful to say here that
      // the parser's own error will not say better about the bytes as given.
      return null
    }
    const format = detectActivityFormat(bytes)
    if (!format) return null
    return {
      source: SOURCE_BY_EXTENSION[`.${format}`],
      ref: { type: 'file', file: new File([bytes], ref.file.name) },
    }
  }

  return {
    // The dispatcher is not itself one of the formats. App.jsx reported 'tcx'
    // here and nothing reads it, but claiming to be one concrete adapter was
    // misleading the moment there were five to choose between.
    kind: 'registry',
    // `async` so a dispatch failure arrives as a *rejection*, not a synchronous
    // throw. The port says load returns a Promise, and ActivityContext's caller
    // only has a `.catch` — a sync throw from here would escape it and land as
    // an unhandled error in a React event handler instead of in ErrorState.
    load: async (ref) => {
      const byName = sourceFor(ref)
      if (byName) return byName.load(ref)
      // Only an unrecognised *file* extension reaches here — `sourceFor`
      // returns a source for everything else, or throws.
      const sniffed = await sniffFileRef(ref)
      return sniffed ? sniffed.source.load(sniffed.ref) : tcxSource.load(ref)
    },
    /**
     * Does a genuinely recorded original file exist for this ref? Asked during
     * render, so it answers from the ref alone and never from the bytes.
     *
     * ⚠️ **Not routed through `sourceFor`.** That dispatches on an extension
     * table with no `.fit.gz` in it, so a gzipped file would silently lose the
     * button it has always had; `activityExtensionOf` matches the optional
     * `.gz` instead. Naming which adapter parses a file and deciding whether it
     * can be trimmed are two different questions, and this is the one place
     * that difference bites.
     *
     * Closures on the object literal rather than class methods, so a test can
     * spread these onto its own double without `this` breaking.
     *
     * @param {ActivityRef} ref
     */
    canExportWindow: (ref) => {
      if (ref?.type === 'file') return activityExtensionOf(ref.file.name) != null
      // Delegated, because only the provider knows. intervals.icu hands back
      // the athlete's original upload; Strava has no such endpoint at all and
      // declines explicitly. `?? false` keeps a provider that has not answered
      // the question from being read as a yes.
      if (ref?.type === 'id') return SOURCE_BY_PROVIDER[ref.provider]?.canExportWindow?.(ref) ?? false
      return false
    },
    /**
     * The original file's bytes, **inflated**. The other half of the export
     * path: `canExportWindow` says a file exists, this produces it.
     *
     * For an id ref this is a real network request, issued on click and never
     * on load — see ExportWindowButton.jsx, which is the app's only non-`load`
     * network call.
     *
     * @param {ActivityRef} ref
     * @returns {Promise<Uint8Array>}
     */
    readOriginalBytes: async (ref) => {
      if (ref?.type === 'file') return readFileBytes(ref)
      // `sourceFor` for the same reason `load` uses it: an id ref with an
      // unknown provider must throw loudly here too rather than guess.
      const source = sourceFor(ref)
      if (!source?.readOriginalBytes) {
        throw new Error("This activity's original file isn't available to download")
      }
      return source.readOriginalBytes(ref)
    },
    // Exposed for the registry's own tests, which assert *which* adapter a ref
    // routes to rather than what it eventually loads. Not part of the
    // ActivitySource port — no component may reach for it. **Null for a file
    // whose extension is unrecognised**: naming it is only half the dispatch
    // now, and the other half needs the bytes.
    sourceFor,
  }
}
