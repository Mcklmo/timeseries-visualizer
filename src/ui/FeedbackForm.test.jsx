import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackForm } from './FeedbackForm.jsx'
import { FEEDBACK_LIMITS } from '../../shared/feedbackLimits.js'

// The real widget is a cross-origin iframe. Stub the global API the hook talks
// to instead, and capture the render options so a solved captcha can be
// simulated by invoking the very callback Cloudflare would.
function stubTurnstile() {
  let renderOptions = null
  window.turnstile = {
    render: vi.fn((_element, options) => {
      renderOptions = options
      return 'widget-1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  return {
    solve: (token = 'token-abc') => act(() => renderOptions.callback(token)),
    expire: () => act(() => renderOptions['expired-callback']()),
    optionsOf: () => renderOptions,
  }
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const createdBody = {
  ok: true,
  issueUrl: 'https://github.com/Mcklmo/timeseries-visualizer/issues/42',
  issueNumber: 42,
}

let turnstile
let fetchMock

beforeEach(() => {
  turnstile = stubTurnstile()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.turnstile
})

/** Renders, waits for the widget to mount, and fills in a valid submission. */
async function renderAndFill(user, { solve = true } = {}) {
  const result = render(<FeedbackForm />)
  await waitFor(() => expect(window.turnstile.render).toHaveBeenCalled())

  await user.type(screen.getByLabelText(/subject/i), 'Cadence panel is blank')
  await user.type(screen.getByLabelText(/^message$/i), 'The cadence chart renders nothing.')
  if (solve) await turnstile.solve()
  return result
}

describe('FeedbackForm', () => {
  it('warns that the issue — and any email given — is public', async () => {
    render(<FeedbackForm />)

    expect(screen.getByText(/public issue on github/i)).toBeInTheDocument()
    expect(screen.getByText(/publicly visible/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email \(optional\)/i)).toBeInTheDocument()
  })

  it('mirrors the shared limits as maxLength hints, without native required/minLength', () => {
    render(<FeedbackForm />)

    const subject = screen.getByLabelText(/subject/i)
    const message = screen.getByLabelText(/^message$/i)
    expect(subject).toHaveAttribute('maxLength', String(FEEDBACK_LIMITS.subject.max))
    expect(message).toHaveAttribute('maxLength', String(FEEDBACK_LIMITS.message.max))
    // the server is the enforcement point — native validation must not
    // intercept submit before the 422 round-trip can happen
    expect(subject).not.toBeRequired()
    expect(message).not.toHaveAttribute('minLength')
  })

  it('keeps submit disabled until the captcha is solved, and re-disables when it expires', async () => {
    render(<FeedbackForm />)
    await waitFor(() => expect(window.turnstile.render).toHaveBeenCalled())
    const submit = screen.getByRole('button', { name: /send feedback/i })
    expect(submit).toBeDisabled()

    await turnstile.solve()
    expect(submit).toBeEnabled()

    await turnstile.expire()
    expect(submit).toBeDisabled()
  })

  it('renders the widget in dark theme with the configured sitekey', async () => {
    render(<FeedbackForm />)
    await waitFor(() => expect(window.turnstile.render).toHaveBeenCalled())

    expect(turnstile.optionsOf()).toMatchObject({ theme: 'dark' })
    expect(turnstile.optionsOf().sitekey).toBeTruthy()
  })

  it('removes the widget on unmount so repeated opens do not leak iframes', async () => {
    const { unmount } = render(<FeedbackForm />)
    await waitFor(() => expect(window.turnstile.render).toHaveBeenCalled())

    unmount()

    expect(window.turnstile.remove).toHaveBeenCalledWith('widget-1')
  })

  it('submits the typed values plus the captcha token and page URL, then shows the issue link', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse(201, createdBody))
    await renderAndFill(user)

    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    await screen.findByText(/filed as issue #42/i)
    expect(screen.getByRole('link', { name: /view it on github/i })).toHaveAttribute(
      'href',
      createdBody.issueUrl,
    )

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      subject: 'Cadence panel is blank',
      message: 'The cadence chart renders nothing.',
      email: '',
      turnstileToken: 'token-abc',
      pageUrl: window.location.href,
    })
  })

  it('shows a 422 as inline field errors and resets the single-use token', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        ok: false,
        error: 'invalid_request',
        message: 'Please fix the highlighted fields and try again.',
        fields: { subject: 'Too short.', message: 'Say a bit more.' },
      }),
    )
    await renderAndFill(user)

    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    expect(await screen.findByText('Too short.')).toBeInTheDocument()
    expect(screen.getByText('Say a bit more.')).toBeInTheDocument()
    expect(screen.getByLabelText(/subject/i)).toHaveAttribute('aria-invalid', 'true')
    // typed text survives so the user can correct it rather than retype it
    expect(screen.getByLabelText(/subject/i)).toHaveValue('Cadence panel is blank')
    expect(window.turnstile.reset).toHaveBeenCalledWith('widget-1')
  })

  it.each([
    [429, 'rate_limited', 'Too many submissions from this connection. Please wait a minute and try again.'],
    [502, 'upstream_error', 'Could not file the issue right now. Please try again later.'],
    [403, 'captcha_failed', 'The verification challenge could not be confirmed. Please try again.'],
  ])('surfaces the %i (%s) message as a single alert', async (status, code, message) => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse(status, { ok: false, error: code, message }))
    await renderAndFill(user)

    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(window.turnstile.reset).toHaveBeenCalled()
  })

  it('surfaces a network failure without losing what was typed', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await renderAndFill(user)

    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
    expect(screen.getByLabelText(/^message$/i)).toHaveValue('The cadence chart renders nothing.')
  })

  it('requires a fresh captcha before the retry, since the failed submit consumed the token', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse(502, { ok: false, error: 'upstream_error', message: 'nope' }))
    await renderAndFill(user)

    await user.click(screen.getByRole('button', { name: /send feedback/i }))
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: /send feedback/i })).toBeDisabled()
    await turnstile.solve('token-second')
    expect(screen.getByRole('button', { name: /send feedback/i })).toBeEnabled()
  })
})
