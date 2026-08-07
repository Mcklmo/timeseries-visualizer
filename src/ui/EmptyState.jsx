// The idle page body: a large drop target, shown only while nothing is
// loaded. The header's compact control (see AppShell) can't carry a first
// run on its own — it's a small dim strip that reads as chrome, so a new
// visitor landed on what looked like a blank page. Once an activity is
// loading/ready/errored this is gone and the header control takes over.
//
// The hint repeats the privacy claim AboutPage already makes: it's the
// single strongest reason to drop a file here rather than upload it
// somewhere, so it belongs at the entrypoint, not only behind the About link.
// It stays attached to the drop zone and says nothing about the intervals.icu
// route, because it is literally true of the file path and nothing else — the
// secondary CTA below carries its own disclosure instead.
import { FileDropZone } from './FileDropZone.jsx'

export function EmptyState({ onFileSelected, onOpenIntervals }) {
  return (
    <div className="empty-state">
      <h2>Load an activity</h2>
      <FileDropZone variant="hero" onFileSelected={onFileSelected} />
      <p className="empty-state__hint">
        Parsed in your browser — your file never leaves your device.
      </p>
      {/* Secondary, and a plain button rather than a second drop zone: on a
          phone there is no practical way to get a watch's .fit file into a
          browser, which is the whole reason this route exists. */}
      <button type="button" className="empty-state__secondary" onClick={onOpenIntervals}>
        Load from intervals.icu
      </button>
      <p className="empty-state__hint">
        Off unless you turn it on. Connect once and your browser talks to intervals.icu directly —
        nothing goes through this app&apos;s server.
      </p>
    </div>
  )
}
