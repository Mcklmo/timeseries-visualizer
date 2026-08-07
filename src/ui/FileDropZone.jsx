// Click-to-browse + drag-and-drop TCX/FIT file picker. Only ever hands a raw
// File up to its parent via onFileSelected — no parsing here, see
// ARCHITECTURE.md §5 (adapters, not components, own interpretation).
//
// Two variants, one component: 'compact' is the persistent header control,
// 'hero' is the big idle-page target in EmptyState. Exactly one of them is
// mounted at a time (AppShell's `showEmptyState`), but only a runtime
// condition keeps them apart — hence the useId() below rather than the
// hardcoded id this used to carry: two live instances would otherwise
// collide on the same DOM id. Both variants deliberately keep the literal
// "click to browse" wording, which is what every test in the repo queries
// the zone by (`getByLabelText(/drop a tcx file|click to browse/i)`).
import { useId, useState } from 'react'

export function FileDropZone({ onFileSelected, variant = 'compact' }) {
  const [isDragActive, setIsDragActive] = useState(false)
  const inputId = useId()

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
      className={`file-drop-zone${variant === 'hero' ? ' file-drop-zone--hero' : ''}${isDragActive ? ' file-drop-zone--active' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={() => setIsDragActive(true)}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
    >
      <label htmlFor={inputId}>
        {variant === 'hero' ? (
          <>
            <span className="file-drop-zone__title">Drop a TCX or FIT file here</span>{' '}
            <span className="file-drop-zone__hint">or click to browse</span>
          </>
        ) : (
          'Click to browse, or drop a TCX/FIT file'
        )}
      </label>
      <input id={inputId} type="file" accept=".tcx,.fit" onChange={handleChange} />
    </div>
  )
}
