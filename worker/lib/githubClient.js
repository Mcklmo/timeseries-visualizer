// The only place the GitHub PAT is used. Nothing here ever returns GitHub's
// own error body to the caller — `status` is kept for server-side logging and
// the route maps any failure to a generic 502, so a mis-scoped or expired
// token can't leak its message (or itself) into a browser response.
const GITHUB_API_ORIGIN = 'https://api.github.com'

// GitHub rejects requests without a User-Agent identifying the caller.
const USER_AGENT = 'activity-visualizer-feedback-worker'

/**
 * @param {object} input
 * @param {string} input.owner
 * @param {string} input.repo
 * @param {string} input.token fine-grained PAT with "Issues: write" on this repo only
 * @param {{title: string, body: string, labels: string[]}} input.payload from buildIssuePayload
 * @param {typeof fetch} [input.fetchImpl]
 * @returns {Promise<{ok: true, issueUrl: string, issueNumber: number} | {ok: false, status: number|null, detail: string}>}
 */
export async function createGithubIssue({ owner, repo, token, payload, fetchImpl = fetch }) {
  const url = `${GITHUB_API_ORIGIN}/repos/${owner}/${repo}/issues`

  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': USER_AGENT,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    return { ok: false, status: null, detail: `request failed: ${error.message}` }
  }

  if (!response.ok) {
    return { ok: false, status: response.status, detail: `github responded ${response.status}` }
  }

  let created
  try {
    created = await response.json()
  } catch {
    return { ok: false, status: response.status, detail: 'github response was not JSON' }
  }

  if (typeof created?.number !== 'number' || typeof created?.html_url !== 'string') {
    return { ok: false, status: response.status, detail: 'github response missing number/html_url' }
  }

  return { ok: true, issueUrl: created.html_url, issueNumber: created.number }
}
