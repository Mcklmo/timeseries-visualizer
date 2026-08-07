import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoadActivityBar } from './LoadActivityBar.jsx'

function makeFile(name = 'run.tcx') {
  return new File(['<xml/>'], name, { type: 'application/vnd.garmin.tcx+xml' })
}

describe('LoadActivityBar', () => {
  it('offers a file drop zone for TCX files', () => {
    render(<LoadActivityBar onFileSelected={() => {}} onLoadSample={() => {}} />)
    expect(screen.getByLabelText(/drop a tcx file|click to browse/i)).toBeInTheDocument()
  })

  it('calls onFileSelected when a file is picked in the drop zone', () => {
    const onFileSelected = vi.fn()
    render(<LoadActivityBar onFileSelected={onFileSelected} onLoadSample={() => {}} />)
    const file = makeFile()

    fireEvent.change(screen.getByLabelText(/drop a tcx file|click to browse/i), {
      target: { files: [file] },
    })

    expect(onFileSelected).toHaveBeenCalledWith(file)
  })

  it('offers a call-to-action to load the sample activity instead', async () => {
    const user = userEvent.setup()
    const onLoadSample = vi.fn()
    render(<LoadActivityBar onFileSelected={() => {}} onLoadSample={onLoadSample} />)

    await user.click(screen.getByRole('button', { name: /sample activity/i }))

    expect(onLoadSample).toHaveBeenCalled()
  })
})
