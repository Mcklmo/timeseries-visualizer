import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackDialog } from './FeedbackDialog.jsx'

// FeedbackDialog renders FeedbackForm while open, which mounts the Turnstile
// widget — stubbed here to the bare API surface the hook touches.
beforeEach(() => {
  window.turnstile = { render: vi.fn(() => 'widget-1'), reset: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.turnstile
})

const getDialog = () => document.querySelector('dialog')

describe('FeedbackDialog', () => {
  it('stays closed — and renders no form — while isOpen is false', () => {
    render(<FeedbackDialog isOpen={false} onRequestClose={() => {}} />)

    expect(getDialog()).not.toHaveAttribute('open')
    expect(screen.queryByLabelText(/subject/i)).not.toBeInTheDocument()
  })

  it('opens modally with the form once isOpen flips', () => {
    const { rerender } = render(<FeedbackDialog isOpen={false} onRequestClose={() => {}} />)
    rerender(<FeedbackDialog isOpen onRequestClose={() => {}} />)

    expect(getDialog()).toHaveAttribute('open')
    expect(screen.getByRole('heading', { name: /send feedback/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/subject/i)).toBeInTheDocument()
  })

  it('is labelled by its own heading', () => {
    render(<FeedbackDialog isOpen onRequestClose={() => {}} />)

    const dialog = screen.getByRole('dialog', { name: /send feedback/i })
    expect(dialog).toBe(getDialog())
  })

  it('reports a close request when the × button is clicked', async () => {
    const user = userEvent.setup()
    const onRequestClose = vi.fn()
    render(<FeedbackDialog isOpen onRequestClose={onRequestClose} />)

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(onRequestClose).toHaveBeenCalledTimes(1)
  })

  // The × button and a real Escape keypress both end in the native `close`
  // event, which is why the listener is attached to the element rather than
  // wired to the button alone. (Escape itself is browser behaviour jsdom does
  // not simulate — see README's manual walkthrough.)
  it('reports a close request for a native close event it did not initiate', () => {
    const onRequestClose = vi.fn()
    render(<FeedbackDialog isOpen onRequestClose={onRequestClose} />)

    getDialog().close()

    expect(onRequestClose).toHaveBeenCalledTimes(1)
  })

  it('does not fire a close request on the initial closed render', () => {
    const onRequestClose = vi.fn()
    render(<FeedbackDialog isOpen={false} onRequestClose={onRequestClose} />)

    expect(onRequestClose).not.toHaveBeenCalled()
  })

  it('unmounts the form on close so re-opening starts with empty fields', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<FeedbackDialog isOpen onRequestClose={() => {}} />)
    await user.type(screen.getByLabelText(/subject/i), 'half-written thought')

    rerender(<FeedbackDialog isOpen={false} onRequestClose={() => {}} />)
    expect(screen.queryByLabelText(/subject/i)).not.toBeInTheDocument()

    rerender(<FeedbackDialog isOpen onRequestClose={() => {}} />)
    expect(screen.getByLabelText(/subject/i)).toHaveValue('')
  })
})
