import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorState } from './ErrorState.jsx'

describe('ErrorState', () => {
  it('shows the error message', () => {
    render(<ErrorState error={new Error('could not parse TCX file')} onRetry={() => {}} />)
    expect(screen.getByText(/could not parse tcx file/i)).toBeInTheDocument()
  })

  it('calls onRetry when the retry button is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState error={new Error('boom')} onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(onRetry).toHaveBeenCalled()
  })
})
