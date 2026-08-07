import { describe, it, expect } from 'vitest'
import { validateFeedback } from './validateFeedback.js'
import { FEEDBACK_LIMITS } from '../../shared/feedbackLimits.js'

const valid = {
  subject: 'Cadence panel is blank',
  message: 'The cadence chart renders nothing for my FIT export.',
  email: 'runner@example.com',
  pageUrl: 'https://example.com/',
  turnstileToken: 'token-abc',
}

describe('validateFeedback', () => {
  it('accepts a complete submission and returns trimmed values', () => {
    const result = validateFeedback({ ...valid, subject: '  Cadence panel is blank  ' })

    expect(result).toEqual({
      ok: true,
      value: { ...valid, subject: 'Cadence panel is blank' },
    })
  })

  it('accepts a submission with no email at all', () => {
    const { email, ...anonymous } = valid
    expect(email).toBeTruthy()

    const result = validateFeedback(anonymous)

    expect(result.ok).toBe(true)
    expect(result.value.email).toBe('')
  })

  it('rejects a too-short subject and message together, one entry per field', () => {
    const result = validateFeedback({ ...valid, subject: 'hi', message: 'short' })

    expect(result.ok).toBe(false)
    expect(Object.keys(result.fields).sort()).toEqual(['message', 'subject'])
    expect(result.fields.subject).toMatch(/3 characters/)
    expect(result.fields.message).toMatch(/10 characters/)
  })

  it('rejects over-long input against the shared limits', () => {
    const result = validateFeedback({
      ...valid,
      subject: 'x'.repeat(FEEDBACK_LIMITS.subject.max + 1),
      message: 'y'.repeat(FEEDBACK_LIMITS.message.max + 1),
    })

    expect(result.ok).toBe(false)
    expect(result.fields.subject).toMatch(/120 characters or fewer/)
    expect(result.fields.message).toMatch(/4000 characters or fewer/)
  })

  it('counts length after trimming, so whitespace padding is not content', () => {
    const result = validateFeedback({ ...valid, message: `   ${'z'.repeat(9)}   ` })

    expect(result.ok).toBe(false)
    expect(result.fields.message).toBeDefined()
  })

  it('rejects a malformed email but not a blank one', () => {
    expect(validateFeedback({ ...valid, email: 'not-an-email' }).ok).toBe(false)
    expect(validateFeedback({ ...valid, email: '   ' }).ok).toBe(true)
  })

  it('requires the turnstile token and page URL the form supplies', () => {
    expect(validateFeedback({ ...valid, turnstileToken: '' }).fields.turnstileToken).toBeDefined()
    expect(validateFeedback({ ...valid, pageUrl: '' }).fields.pageUrl).toBeDefined()
  })

  it('treats non-string and missing values as empty rather than throwing', () => {
    for (const input of [null, undefined, 'a string body', 42, { subject: 42, message: [] }]) {
      const result = validateFeedback(input)
      expect(result.ok).toBe(false)
      expect(result.fields.subject).toBeDefined()
    }
  })
})
