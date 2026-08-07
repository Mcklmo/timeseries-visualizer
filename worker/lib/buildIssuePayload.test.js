import { describe, it, expect } from 'vitest'
import { buildIssuePayload } from './buildIssuePayload.js'

const base = {
  subject: 'Cadence panel is blank',
  message: 'The cadence chart renders nothing for my FIT export, but Garmin shows cadence.',
  pageUrl: 'https://example.com/?a=1',
  userAgent: 'Mozilla/5.0 (Macintosh)',
  timestamp: '2026-08-07T10:11:12.000Z',
}

describe('buildIssuePayload', () => {
  it('uses the subject as the title and labels every issue "feedback"', () => {
    const payload = buildIssuePayload(base)

    expect(payload.title).toBe('Cadence panel is blank')
    expect(payload.labels).toEqual(['feedback'])
  })

  it('leads with the message, then the server-captured metadata', () => {
    const { body } = buildIssuePayload(base)

    expect(body.startsWith(base.message)).toBe(true)
    expect(body).toContain('- Page: `https://example.com/?a=1`')
    expect(body).toContain('- Submitted: `2026-08-07T10:11:12.000Z`')
    expect(body).toContain('- User agent: `Mozilla/5.0 (Macintosh)`')
  })

  it('includes the reporter email only when one was given', () => {
    expect(buildIssuePayload({ ...base, email: 'runner@example.com' }).body).toContain(
      '- Reporter email: `runner@example.com`',
    )
    // an anonymous report gets no line at all, rather than an empty one that
    // would read as a redaction
    expect(buildIssuePayload({ ...base, email: '' }).body).not.toContain('Reporter email')
    expect(buildIssuePayload(base).body).not.toContain('Reporter email')
  })

  it('falls back to "unknown" when the request carried no User-Agent', () => {
    expect(buildIssuePayload({ ...base, userAgent: undefined }).body).toContain(
      '- User agent: `unknown`',
    )
  })

  it('flattens a multi-line subject — GitHub issue titles are single-line', () => {
    const { title } = buildIssuePayload({ ...base, subject: 'Blank\n\tcadence   panel' })

    expect(title).toBe('Blank cadence panel')
  })

  it('strips backticks and newlines from metadata so a crafted value cannot break out of its code span', () => {
    const { body } = buildIssuePayload({
      ...base,
      pageUrl: 'https://example.com/`\n### injected heading',
      userAgent: 'UA`with`ticks',
    })

    expect(body).toContain('- Page: `https://example.com/  ### injected heading`')
    expect(body).toContain('- User agent: `UA with ticks`')
    // one bullet per metadata line — the injected newline did not split it
    expect(body.split('\n').filter((line) => line.startsWith('- Page:'))).toHaveLength(1)
  })
})
