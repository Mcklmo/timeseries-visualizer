// Persistent header control for getting an activity in — visible across every
// ActivityContext.status, not just 'idle', so a different activity can be
// loaded without leaving the graph view. Drop/browse a TCX or FIT file, or
// load the bundled sample so the UI can be explored without a real export.
import { FileDropZone } from './FileDropZone.jsx'

export function LoadActivityBar({ onFileSelected, onLoadSample }) {
  return (
    <div className="load-activity-bar">
      <FileDropZone onFileSelected={onFileSelected} />
      <button type="button" onClick={onLoadSample}>
        Load sample activity
      </button>
    </div>
  )
}
