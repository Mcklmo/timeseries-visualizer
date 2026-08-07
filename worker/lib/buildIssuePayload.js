// Pure: submission + server-captured metadata -> the exact JSON body posted to
// GitHub's create-issue endpoint. Kept separate from githubClient.js so the
// rendered markdown can be asserted directly, with no fetch in the picture.

export const FEEDBACK_LABEL = 'feedback'

// Metadata values are rendered inside `code spans`, so a stray backtick would
// break out of the span and let the rest of the value render as markdown.
// Newlines would break the bullet list the same way. Neither belongs in a URL
// or a User-Agent, so stripping is lossless in practice.
const asCodeSpan = (value) => `\`${String(value).replace(/[`\r\n]/g, ' ').trim()}\``

// GitHub issue titles are single-line; a pasted multi-line subject would
// otherwise arrive with literal newlines in it.
const asSingleLine = (value) => String(value).replace(/\s+/g, ' ').trim()

/**
 * @param {object} input
 * @param {string} input.subject
 * @param {string} input.message
 * @param {string} [input.email] blank when the reporter stayed anonymous
 * @param {string} input.pageUrl
 * @param {string} [input.userAgent] captured server-side from the request headers
 * @param {string} input.timestamp ISO-8601, captured server-side (never trusted from the client)
 * @returns {{title: string, body: string, labels: string[]}}
 */
export function buildIssuePayload({ subject, message, email, pageUrl, userAgent, timestamp }) {
  const metadata = [
    `- Page: ${asCodeSpan(pageUrl)}`,
    `- Submitted: ${asCodeSpan(timestamp)}`,
    `- User agent: ${asCodeSpan(userAgent || 'unknown')}`,
    // Reporters who leave the email blank get no line at all rather than an
    // empty one, so an anonymous report doesn't read as a redacted one.
    ...(email ? [`- Reporter email: ${asCodeSpan(email)}`] : []),
  ]

  const body = [
    message.trim(),
    '',
    '---',
    '',
    ...metadata,
    '',
    '_Filed automatically from the in-app feedback form._',
  ].join('\n')

  return { title: asSingleLine(subject), body, labels: [FEEDBACK_LABEL] }
}
