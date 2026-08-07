import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from './EmptyState.jsx'

function makeFile(name = 'run.tcx') {
  return new File(['<xml/>'], name, { type: 'application/vnd.garmin.tcx+xml' })
}

describe('EmptyState', () => {
  it('names what the page wants and offers a drop zone for TCX/FIT files', () => {
    render(<EmptyState onFileSelected={() => {}} />)
    expect(screen.getByRole('heading', { name: /load an activity/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/drop a tcx file|click to browse/i)).toBeInTheDocument()
  })

  it('calls onFileSelected when a file is picked in the drop zone', () => {
    const onFileSelected = vi.fn()
    render(<EmptyState onFileSelected={onFileSelected} />)
    const file = makeFile()

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [file] },
    })

    expect(onFileSelected).toHaveBeenCalledWith(file)
  })
})
