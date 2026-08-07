// The feedback dialog's body: fields, the Turnstile widget mount point, and
// the submit/validation/result states.
//
// Client-side length limits are `maxLength` hints only — deliberately no
// `required`/`minLength`, so the browser never blocks submit with its own
// validation bubble and the server stays the single source of truth for what
// counts as valid (worker/lib/validateFeedback.js, same shared numbers).
import { useState } from 'react'
import { FEEDBACK_LIMITS } from '../../shared/feedbackLimits.js'
import { submitFeedback } from '../lib/feedbackClient.js'
import { useTurnstile } from './useTurnstile.js'

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

export function FeedbackForm() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [created, setCreated] = useState(null)
  const { containerRef, token, status: captchaStatus, resetToken } = useTurnstile()

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setFieldErrors({})
    setFormError(null)

    const result = await submitFeedback({
      subject,
      message,
      email,
      turnstileToken: token ?? '',
      pageUrl: window.location.href,
    })

    if (result.ok) {
      setCreated(result)
      return
    }

    setFieldErrors(result.fields ?? {})
    setFormError(result.message || FALLBACK_ERROR)
    // Turnstile tokens are single-use: without a reset the user would be stuck
    // re-submitting a token the server has already consumed.
    resetToken()
    setIsSubmitting(false)
  }

  if (created) {
    return (
      <div className="feedback-form__success" role="status">
        <p>Thanks — your feedback was filed as issue #{created.issueNumber}.</p>
        <a href={created.issueUrl} target="_blank" rel="noreferrer noopener">
          View it on GitHub
        </a>
      </div>
    )
  }

  return (
    <form className="feedback-form" onSubmit={handleSubmit} noValidate>
      <p className="feedback-form__notice">
        This opens a public issue on GitHub. Anything you write here — including your email address,
        if you give one — is publicly visible.
      </p>

      <label htmlFor="feedback-subject">Subject</label>
      <input
        id="feedback-subject"
        name="subject"
        type="text"
        value={subject}
        maxLength={FEEDBACK_LIMITS.subject.max}
        onChange={(event) => setSubject(event.target.value)}
        aria-invalid={fieldErrors.subject ? 'true' : undefined}
        aria-describedby={fieldErrors.subject ? 'feedback-subject-error' : undefined}
      />
      {fieldErrors.subject && (
        <p className="feedback-form__error" id="feedback-subject-error">
          {fieldErrors.subject}
        </p>
      )}

      <label htmlFor="feedback-message">Message</label>
      <textarea
        id="feedback-message"
        name="message"
        rows={6}
        value={message}
        maxLength={FEEDBACK_LIMITS.message.max}
        onChange={(event) => setMessage(event.target.value)}
        aria-invalid={fieldErrors.message ? 'true' : undefined}
        aria-describedby={fieldErrors.message ? 'feedback-message-error' : undefined}
      />
      {fieldErrors.message && (
        <p className="feedback-form__error" id="feedback-message-error">
          {fieldErrors.message}
        </p>
      )}

      <label htmlFor="feedback-email">Email (optional)</label>
      <input
        id="feedback-email"
        name="email"
        type="email"
        value={email}
        maxLength={FEEDBACK_LIMITS.email.max}
        onChange={(event) => setEmail(event.target.value)}
        aria-invalid={fieldErrors.email ? 'true' : undefined}
        aria-describedby={fieldErrors.email ? 'feedback-email-error' : undefined}
      />
      <p className="feedback-form__hint">Only so I can reply. Leave it blank to stay anonymous.</p>
      {fieldErrors.email && (
        <p className="feedback-form__error" id="feedback-email-error">
          {fieldErrors.email}
        </p>
      )}

      <div className="feedback-form__captcha" ref={containerRef} />
      {captchaStatus === 'unavailable' && (
        <p className="feedback-form__error">
          The verification challenge could not be loaded, so feedback can&apos;t be sent right now.
        </p>
      )}

      {formError && (
        <p className="feedback-form__error" role="alert">
          {formError}
        </p>
      )}

      <button type="submit" disabled={!token || isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send feedback'}
      </button>
    </form>
  )
}
