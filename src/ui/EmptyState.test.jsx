import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from './EmptyState.jsx'

function makeFile(name = 'run.tcx') {
  return new File(['<xml/>'], name, { type: 'application/vnd.garmin.tcx+xml' })
}

describe('EmptyState', () => {
  it('names what the page wants and offers a drop zone for TCX/FIT files', () => {
    render(<EmptyState onFileSelected={() => {}} onOpenIntervals={() => {}} />)
    expect(screen.getByRole('heading', { name: /load an activity/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/drop a tcx file|click to browse/i)).toBeInTheDocument()
  })

  it('calls onFileSelected when a file is picked in the drop zone', () => {
    const onFileSelected = vi.fn()
    render(<EmptyState onFileSelected={onFileSelected} onOpenIntervals={() => {}} />)
    const file = makeFile()

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [file] },
    })

    expect(onFileSelected).toHaveBeenCalledWith(file)
  })

  it('offers the intervals.icu route as a secondary CTA', () => {
    const onOpenIntervals = vi.fn()
    render(<EmptyState onFileSelected={() => {}} onOpenIntervals={onOpenIntervals} />)

    fireEvent.click(screen.getByRole('button', { name: /load from intervals\.icu/i }))

    expect(onOpenIntervals).toHaveBeenCalled()
  })

  // The file claim must stay literally true of the file path, so the network
  // disclosure hangs off the new CTA as its own line rather than watering the
  // hero's hint down.
  it('keeps the file-never-leaves claim on the drop zone and the network disclosure on the CTA', () => {
    render(<EmptyState onFileSelected={() => {}} onOpenIntervals={() => {}} />)

    expect(screen.getByText(/your file never leaves your device/i)).toBeInTheDocument()
    expect(screen.getByText(/off unless you turn it on/i)).toBeInTheDocument()
  })
})
