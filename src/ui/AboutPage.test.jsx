import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutPage } from './AboutPage.jsx'

describe('AboutPage', () => {
  it('shows the client-side-processing and motivation copy', () => {
    render(<AboutPage onBack={() => {}} />)
    expect(screen.getByText(/runs entirely in your browser/i)).toBeInTheDocument()
    expect(screen.getByText(/mostly satisfied user of Garmin Connect/i)).toBeInTheDocument()
  })

  it('links Intervals.icu to its home page in a new tab', () => {
    render(<AboutPage onBack={() => {}} />)

    const link = screen.getByRole('link', { name: /intervals\.icu/i })
    expect(link).toHaveAttribute('href', 'https://www.intervals.icu')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('calls onBack when the back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<AboutPage onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(onBack).toHaveBeenCalled()
  })
})
