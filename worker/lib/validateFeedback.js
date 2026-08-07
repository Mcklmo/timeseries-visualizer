// Server-authoritative validation. The client mirrors FEEDBACK_LIMITS for
// maxLength/hint copy only — it is a UX affordance, never the enforcement
// point, so everything is re-checked here against the same shared numbers.
import { FEEDBACK_LIMITS } from '../../shared/feedbackLimits.js'

// Deliberately loose: the point is to catch a typo'd address before it becomes
// a dead reply-to on a public issue, not to prove deliverability (only sending
// mail does that). Anything stricter rejects valid addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * @param {unknown} input parsed JSON body, untrusted
 * @returns {{ok: true, value: {subject: string, message: string, email: string, pageUrl: string, turnstileToken: string}}
 *          | {ok: false, fields: Record<string, string>}}
 */
export function validateFeedback(input) {
  const fields = {}
  const body = input && typeof input === 'object' ? input : {}

  const subject = asTrimmedString(body.subject)
  if (subject.length < FEEDBACK_LIMITS.subject.min) {
    fields.subject = `Please give the issue a subject of at least ${FEEDBACK_LIMITS.subject.min} characters.`
  } else if (subject.length > FEEDBACK_LIMITS.subject.max) {
    fields.subject = `Subject must be ${FEEDBACK_LIMITS.subject.max} characters or fewer.`
  }

  const message = asTrimmedString(body.message)
  if (message.length < FEEDBACK_LIMITS.message.min) {
    fields.message = `Please write at least ${FEEDBACK_LIMITS.message.min} characters so the report is actionable.`
  } else if (message.length > FEEDBACK_LIMITS.message.max) {
    fields.message = `Message must be ${FEEDBACK_LIMITS.message.max} characters or fewer.`
  }

  // Optional: an empty/absent email is valid and simply omitted from the issue.
  const email = asTrimmedString(body.email)
  if (email.length > FEEDBACK_LIMITS.email.max) {
    fields.email = `Email must be ${FEEDBACK_LIMITS.email.max} characters or fewer.`
  } else if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
    fields.email = 'That does not look like an email address. Leave it blank to stay anonymous.'
  }

  // Both of these are set by the form, not typed by the user, so their copy is
  // "something went wrong" rather than "fix your input" — they only surface if
  // the captcha expired mid-typing or the request wasn't sent by our own form.
  const turnstileToken = asTrimmedString(body.turnstileToken)
  if (turnstileToken.length === 0) {
    fields.turnstileToken = 'The verification challenge was not completed.'
  }

  const pageUrl = asTrimmedString(body.pageUrl)
  if (pageUrl.length === 0) {
    fields.pageUrl = 'Missing page URL.'
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return { ok: true, value: { subject, message, email, pageUrl, turnstileToken } }
}
