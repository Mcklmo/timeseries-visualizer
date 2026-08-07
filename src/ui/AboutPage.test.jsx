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

  // The local-parsing claim above is still true and stays, but it stops being
  // stated as an absolute: two opt-in features do reach the network, and a
  // reader who used one should not feel the page misled them.
  it('names both network exceptions without watering down the local-parsing claim', () => {
    render(<AboutPage onBack={() => {}} />)

    expect(screen.getByText(/never sent to a server/i)).toBeInTheDocument()
    const disclosure = screen.getByText(/only when you ask them to/i)
    expect(disclosure).toHaveTextContent(/posts what you write to GitHub as a public issue/i)
    expect(disclosure).toHaveTextContent(/never pass through this app's server/i)
  })

  // getByRole throws on two matches, so About deliberately keeps exactly one
  // Intervals.icu link — the disclosure paragraph names it as plain text.
  it('links Intervals.icu to its home page in a new tab, and only once', () => {
    render(<AboutPage onBack={() => {}} />)

    expect(screen.getAllByRole('link', { name: /intervals\.icu/i })).toHaveLength(1)
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
