// Shown while ActivityContext.status is 'idle' — nothing loaded yet. Offers
// the two ways to get an activity in: drop/browse a TCX file, or load the
// bundled sample so the UI can be explored without a real export on hand.
import { FileDropZone } from './FileDropZone.jsx'

export function EmptyState({ onFileSelected, onLoadSample }) {
  return (
    <div className="empty-state">
      <h2>Load an activity</h2>
      <FileDropZone onFileSelected={onFileSelected} />
      <p className="empty-state-or">or</p>
      <button type="button" onClick={onLoadSample}>
        Load sample activity
      </button>
    </div>
  )
}
