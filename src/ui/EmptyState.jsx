// The idle page body: a large drop target, shown only while nothing is
// loaded. The header's compact control (see AppShell) can't carry a first
// run on its own — it's a small dim strip that reads as chrome, so a new
// visitor landed on what looked like a blank page. Once an activity is
// loading/ready/errored this is gone and the header control takes over.
//
// The hint repeats the privacy claim AboutPage already makes: it's the
// single strongest reason to drop a file here rather than upload it
// somewhere, so it belongs at the entrypoint, not only behind the About link.
import { FileDropZone } from './FileDropZone.jsx'

export function EmptyState({ onFileSelected }) {
  return (
    <div className="empty-state">
      <h2>Load an activity</h2>
      <FileDropZone variant="hero" onFileSelected={onFileSelected} />
      <p className="empty-state__hint">
        Parsed in your browser — your file never leaves your device.
      </p>
    </div>
  )
}
