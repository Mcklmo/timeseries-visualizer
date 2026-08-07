// Click-to-browse + drag-and-drop TCX/FIT file picker. Only ever hands a raw
// File up to its parent via onFileSelected — no parsing here, see
// ARCHITECTURE.md §5 (adapters, not components, own interpretation).
import { useState } from 'react'

export function FileDropZone({ onFileSelected }) {
  const [isDragActive, setIsDragActive] = useState(false)

  function handleChange(event) {
    const file = event.target.files[0]
    if (file) onFileSelected(file)
    event.target.value = ''
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragActive(false)
    const file = event.dataTransfer.files[0]
    if (file) onFileSelected(file)
  }

  function handleDragOver(event) {
    event.preventDefault()
  }

  return (
    <div
      className={`file-drop-zone${isDragActive ? ' file-drop-zone--active' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={() => setIsDragActive(true)}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
    >
      <label htmlFor="tcx-file-input">
        <strong>Drop a TCX or FIT file</strong> here, or click to browse
      </label>
      <input id="tcx-file-input" type="file" accept=".tcx,.fit" onChange={handleChange} />
    </div>
  )
}
