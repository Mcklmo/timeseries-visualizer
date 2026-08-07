// Every /api/feedback response goes through here so the wire shape stays
// uniform: success is `{ok: true, ...}`, failure is `{ok: false, error, message}`
// with an optional per-field map. src/lib/feedbackClient.js decodes exactly
// this contract — see the table in README/plan for status -> code pairs.

/** @param {number} status @param {object} body @param {Record<string,string>} [headers] */
export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

/**
 * `message` is user-facing copy — never interpolate an upstream error body or
 * anything token-adjacent into it.
 * @param {number} status
 * @param {string} code machine-readable, stable across copy changes
 * @param {string} message
 * @param {Record<string,string>} [fields] field name -> validation message
 * @param {Record<string,string>} [headers]
 */
export function errorResponse(status, code, message, fields, headers) {
  const body = { ok: false, error: code, message }
  if (fields) body.fields = fields
  return jsonResponse(status, body, headers)
}
