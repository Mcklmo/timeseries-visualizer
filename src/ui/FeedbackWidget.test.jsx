import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackWidget } from './FeedbackWidget.jsx'

beforeEach(() => {
  window.turnstile = { render: vi.fn(() => 'widget-1'), reset: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.turnstile
})

describe('FeedbackWidget', () => {
  it('shows only the trigger until it is clicked', () => {
    render(<FeedbackWidget />)

    expect(screen.getByRole('button', { name: /feedback/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the dialog from the trigger', async () => {
    const user = userEvent.setup()
    render(<FeedbackWidget />)

    await user.click(screen.getByRole('button', { name: /feedback/i }))

    expect(screen.getByRole('dialog', { name: /send feedback/i })).toBeInTheDocument()
  })

  it('closes again from the × button, and can be re-opened', async () => {
    const user = userEvent.setup()
    render(<FeedbackWidget />)

    await user.click(screen.getByRole('button', { name: /^feedback$/i }))
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^feedback$/i }))
    expect(screen.getByRole('dialog', { name: /send feedback/i })).toBeInTheDocument()
  })
})
