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

  it('offers the Strava route beside it', () => {
    const onOpenStrava = vi.fn()
    render(<EmptyState onFileSelected={() => {}} onOpenStrava={onOpenStrava} />)

    fireEvent.click(screen.getByRole('button', { name: /load from strava/i }))

    expect(onOpenStrava).toHaveBeenCalled()
  })

  // The file claim must stay literally true of the file path, so it stays on
  // the drop zone and says nothing about the account routes.
  it('keeps the file-never-leaves claim attached to the drop zone alone', () => {
    render(<EmptyState onFileSelected={() => {}} />)

    const hint = screen.getByText(/your file never leaves your device/i)
    expect(hint).toBeInTheDocument()
    expect(hint).not.toHaveTextContent(/intervals\.icu|strava/i)
  })

  // **The reason the two CTAs share one paragraph.** They used to be one CTA
  // with its own "nothing goes through this app's server" line — true of
  // intervals.icu and false of Strava. Two adjacent buttons with opposite
  // privacy claims read as a bug in the copy rather than as precision, and the
  // reader who spots the contradiction is exactly the reader it was written
  // for. If a future edit splits this back into two lines, this test is what
  // should stop it.
  it('covers both account routes in ONE disclosure that names the difference', () => {
    render(<EmptyState onFileSelected={() => {}} />)

    const disclosure = screen.getByText(/both are off unless you turn them on/i)
    expect(disclosure).toHaveTextContent(/talks to\s+intervals\.icu\s+directly/i)
    expect(disclosure).toHaveTextContent(/nothing about it reaches this app's server/i)
    expect(disclosure).toHaveTextContent(/is the exception and does go through it/i)
    expect(disclosure).toHaveTextContent(/stores nothing/i)
    expect(disclosure).toHaveTextContent(/revokes the access at Strava/i)

    // And there is exactly one of them — not one claim per button.
    expect(screen.queryByText(/nothing goes through this app's server/i)).not.toBeInTheDocument()
  })
})
