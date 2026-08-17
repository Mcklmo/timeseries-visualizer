// THE dependency-injection boundary — see ARCHITECTURE.md §5. No component
// ever imports an adapter directly; everything talks to this shape, injected
// via ActivitySourceProvider. Swapping mock -> tcx -> intervals changes only
// the instance passed to the provider.
import { createContext, createElement, useContext } from 'react'

/**
 * Which remote account an `{type:'id'}` ref belongs to. **Required on the ref**
 * — an id alone is not enough to dispatch on once there is more than one
 * provider, and the failure mode of guessing is loading from the wrong
 * athlete's account, which is worth making unrepresentable rather than
 * unlikely. sourceRegistry.js throws on an id ref that omits it.
 * @typedef {'intervals'|'strava'} ActivityProvider
 */

/**
 * `name` is optional and purely additive: nothing that produces a file ref can
 * fill it in, because neither FIT nor TCX carries a title (§8) — so `Activity.name`
 * is inferred by deriveWorkoutName. A provider *does* know the real title,
 * and tapping "Tempo 5×1k" only to land on a chart headed "Morning Run" reads
 * as a bug. Every consumer must still work without it.
 *
 * `startedAtUtc` is optional and additive in the same way, following the exact
 * precedent `name` set. It is the activity's true instant as an ISO string,
 * carried from the picker row so an adapter that receives *relative* sample
 * offsets — Strava's `time` stream is seconds from the start — can rebuild
 * absolute timestamps without a second API request. Deliberately spelled the
 * same on the ref and on ActivityRow, so the two can never come to mean
 * different things in two files. Providers that hand back a file with real
 * timestamps in it (intervals.icu) neither send nor need it.
 *
 * `sportType` is the third of these, and the last thing a picker row knows that
 * an adapter cannot cheaply re-derive. A provider that returns *telemetry*
 * rather than a recorded file has no sport field anywhere in that telemetry —
 * Strava's stream set is seven parallel arrays of numbers — and the sport has
 * to be known **before** the samples are assembled, because cadence for a foot
 * sport is reported per-leg and must be doubled. Fetching the activity's detail
 * just to learn its sport would be a second request per activity opened. Passed
 * through uninterpreted; each provider's own module knows what its values mean.
 *
 * @typedef {{ type: 'file', file: File }} FileActivityRef
 * @typedef {{ type: 'id', provider: ActivityProvider, id: string, name?: string,
 *             startedAtUtc?: string, sportType?: string }} IdActivityRef
 * @typedef {FileActivityRef | IdActivityRef} ActivityRef
 */

/**
 * The port. `load` is the whole contract for reading; the two export methods
 * are the whole contract for writing a window back out.
 *
 * **Both export methods are OPTIONAL, and every call site must treat them so**
 * — `source.canExportWindow?.(ref) ?? false`, i.e. a source that does not
 * answer cannot export. That is a concession to test doubles, not a hole in
 * production: there are ~17 inline `{kind:'mock', load}` sources across the UI
 * suites, and the only source App.jsx ever publishes is the registry, which
 * always implements both. An unguarded call would turn every one of those
 * doubles into a TypeError the moment its tree reached the export button.
 *
 * `canExportWindow` is **synchronous** because it is asked during render, to
 * decide whether the button exists at all. It therefore answers from the ref
 * alone — a filename for a dropped file, a provider for a synced one — and
 * never from the bytes. ExportWindowButton.jsx argues that trade in full.
 *
 * `readOriginalBytes` returns **inflated** bytes, so a caller never has to know
 * whether they came off disk gzipped or off the wire. It is allowed to reject:
 * a provider with no original-file endpoint (Strava) declines explicitly rather
 * than by omission, and a network provider's own error codes propagate.
 *
 * @typedef {object} ActivitySource
 * @property {'tcx'|'fit'|'gpx'|'intervals'|'strava'|'registry'|'mock'} kind
 * @property {(ref: ActivityRef) => Promise<import('../domain/types.js').Activity>} load
 * @property {(ref: ActivityRef) => boolean} [canExportWindow]
 * @property {(ref: ActivityRef) => Promise<Uint8Array>} [readOriginalBytes]
 */

const ActivitySourceContext = createContext(undefined)

/**
 * Publishes an ActivitySource instance on context. Swapping mock -> tcx ->
 * intervals is exactly: change the `source` instance passed here, nothing else.
 * @param {{ source: ActivitySource, children: import('react').ReactNode }} props
 */
export function ActivitySourceProvider({ source, children }) {
  return createElement(ActivitySourceContext.Provider, { value: source }, children)
}

/** @returns {ActivitySource} */
export function useActivitySource() {
  const source = useContext(ActivitySourceContext)
  if (source === undefined) {
    throw new Error('useActivitySource must be used within an ActivitySourceProvider')
  }
  return source
}
