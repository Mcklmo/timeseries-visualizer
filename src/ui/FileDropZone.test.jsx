import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileDropZone } from './FileDropZone.jsx'

function makeFile(name = 'run.tcx') {
  return new File(['<xml/>'], name, { type: 'application/vnd.garmin.tcx+xml' })
}

describe('FileDropZone', () => {
  it('renders a labelled file input accepting every supported format', () => {
    render(<FileDropZone onFileSelected={() => {}} />)
    const input = screen.getByLabelText(/drop a tcx file|click to browse/i)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', '.tcx,.fit,.gpx')
  })

  it('calls onFileSelected with the chosen file when picked via the input', () => {
    const onFileSelected = vi.fn()
    render(<FileDropZone onFileSelected={onFileSelected} />)
    const file = makeFile()

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [file] },
    })

    expect(onFileSelected).toHaveBeenCalledWith(file)
  })

  it('does not call onFileSelected when the input change has no files', () => {
    const onFileSelected = vi.fn()
    render(<FileDropZone onFileSelected={onFileSelected} />)

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [] },
    })

    expect(onFileSelected).not.toHaveBeenCalled()
  })

  it('calls onFileSelected with the dropped file', () => {
    const onFileSelected = vi.fn()
    const { container } = render(<FileDropZone onFileSelected={onFileSelected} />)
    const file = makeFile('dropped.tcx')
    const zone = container.querySelector('.file-drop-zone')

    fireEvent.drop(zone, { dataTransfer: { files: [file] } })

    expect(onFileSelected).toHaveBeenCalledWith(file)
  })

  it('marks itself active while a file is dragged over, and clears on drag leave', () => {
    const { container } = render(<FileDropZone onFileSelected={() => {}} />)
    const zone = container.querySelector('.file-drop-zone')

    fireEvent.dragEnter(zone)
    expect(zone).toHaveClass('file-drop-zone--active')

    fireEvent.dragLeave(zone)
    expect(zone).not.toHaveClass('file-drop-zone--active')
  })

  // The hero variant is the idle-page target; it must stay findable by the
  // same label query the compact one uses (see the component's comment).
  it('renders the hero variant with the same browse affordance', () => {
    const { container } = render(<FileDropZone variant="hero" onFileSelected={() => {}} />)

    expect(container.querySelector('.file-drop-zone')).toHaveClass('file-drop-zone--hero')
    expect(screen.getByLabelText(/click to browse/i)).toBeInTheDocument()
  })

  it('clears the active state after a drop', () => {
    const { container } = render(<FileDropZone onFileSelected={() => {}} />)
    const zone = container.querySelector('.file-drop-zone')

    fireEvent.dragEnter(zone)
    fireEvent.drop(zone, { dataTransfer: { files: [makeFile()] } })

    expect(zone).not.toHaveClass('file-drop-zone--active')
  })
})
