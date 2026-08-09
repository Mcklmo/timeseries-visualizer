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
//   - **A file ref dispatches on the filename extension.** An unrecognised
//     extension falls through to TcxActivitySource, which rejects it with a
//     real parser error rather than a shrug — deliberate, and load-bearing in
//     the tests. (Known rough edge, its own change: the *file* path trusts the
//     extension while the *network* path sniffs bytes via fileFormat.js, so a
//     `.fit.gz` dropped on the page dies on "invalid XML" with the inflate
//     code sitting one directory away.)
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
    return extension ? SOURCE_BY_EXTENSION[extension] : tcxSource
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
    load: async (ref) => sourceFor(ref).load(ref),
    // Exposed for the registry's own tests, which assert *which* adapter a ref
    // routes to rather than what it eventually loads. Not part of the
    // ActivitySource port — no component may reach for it.
    sourceFor,
  }
}
