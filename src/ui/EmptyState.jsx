// The idle page body: a large drop target, shown only while nothing is
// loaded. The header's compact control (see AppShell) can't carry a first
// run on its own — it's a small dim strip that reads as chrome, so a new
// visitor landed on what looked like a blank page. Once an activity is
// loading/ready/errored this is gone and the header control takes over.
//
// The hint under the drop zone repeats the privacy claim AboutPage already
// makes: it's the single strongest reason to drop a file here rather than
// upload it somewhere, so it belongs at the entrypoint, not only behind the
// About link. It stays attached to the drop zone and says nothing about the
// account routes, because it is literally true of the file path and nothing
// else.
//
// **The two account CTAs share ONE disclosure, and that restructure is the
// point.** They used to be one CTA with its own line saying "nothing goes
// through this app's server" — which is true of intervals.icu and false of
// Strava. Two adjacent buttons with opposite privacy claims read as a bug in
// the copy rather than as precision, and the reader who notices the
// contradiction is exactly the reader the claim was written for. So there is
// one paragraph, it covers both, and it names the difference in the same breath
// rather than letting the stronger claim quietly stand for both.
//
// Ordered intervals.icu first, deliberately: it is the older route, it hands
// back the *original file* (so it charts identically to a dropped one), and it
// is the one whose privacy story is unqualified. Strava is second and says so.
import { FileDropZone } from './FileDropZone.jsx'

export function EmptyState({ onFileSelected, onOpenIntervals, onOpenStrava }) {
  return (
    <div className="empty-state">
      <h2>Load an activity</h2>
      <FileDropZone variant="hero" onFileSelected={onFileSelected} />
      <p className="empty-state__hint">
        Parsed in your browser — your file never leaves your device.
      </p>

      {/* Secondary, and plain buttons rather than more drop zones: on a phone
          there is no practical way to get a watch's .fit file into a browser,
          which is the whole reason these routes exist. */}
      <div className="empty-state__secondaries">
        <button type="button" className="empty-state__secondary" onClick={onOpenIntervals}>
          Load from intervals.icu
        </button>
        <button type="button" className="empty-state__secondary" onClick={onOpenStrava}>
          Load from Strava
        </button>
      </div>

      <p className="empty-state__hint">
        Both are off unless you turn them on, and either can be disconnected in one press. Your
        browser talks to <strong>intervals.icu</strong> directly, so nothing about it reaches this
        app&apos;s server. <strong>Strava</strong> is the exception and does go through it — Strava
        requires a secret a web page can&apos;t hold — but that server stores nothing, and
        disconnecting revokes the access at Strava rather than just forgetting it here.
      </p>
    </div>
  )
}
