import { describe, it, expect, vi } from 'vitest'
import { createGithubIssue } from './githubClient.js'

const payload = { title: 'Cadence panel is blank', body: 'details', labels: ['feedback'] }

const args = (fetchImpl) => ({
  owner: 'Mcklmo',
  repo: 'timeseries-visualizer',
  token: 'github_pat_example',
  payload,
  fetchImpl,
})

const createdResponse = (body = { number: 42, html_url: 'https://github.com/Mcklmo/timeseries-visualizer/issues/42' }) =>
  new Response(JSON.stringify(body), { status: 201 })

describe('createGithubIssue', () => {
  it('POSTs the payload to the repo issues endpoint with the documented headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(createdResponse())

    await createGithubIssue(args(fetchImpl))

    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/Mcklmo/timeseries-visualizer/issues')
    expect(options.method).toBe('POST')
    expect(options.headers.authorization).toBe('Bearer github_pat_example')
    expect(options.headers.accept).toBe('application/vnd.github+json')
    expect(options.headers['x-github-api-version']).toBe('2022-11-28')
    expect(options.headers['user-agent']).toBe('activity-visualizer-feedback-worker')
    expect(JSON.parse(options.body)).toEqual(payload)
  })

  it('returns the created issue number and URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(createdResponse())

    await expect(createGithubIssue(args(fetchImpl))).resolves.toEqual({
      ok: true,
      issueUrl: 'https://github.com/Mcklmo/timeseries-visualizer/issues/42',
      issueNumber: 42,
    })
  })

  it('reports a non-2xx as a failure without echoing GitHub\'s error body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }))

    const result = await createGithubIssue(args(fetchImpl))

    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(JSON.stringify(result)).not.toContain('Bad credentials')
    expect(JSON.stringify(result)).not.toContain('github_pat_example')
  })

  it('treats a 2xx with a malformed or incomplete body as a failure', async () => {
    const notJson = vi.fn().mockResolvedValue(new Response('<html>', { status: 201 }))
    await expect(createGithubIssue(args(notJson))).resolves.toMatchObject({ ok: false })

    const missingFields = vi.fn().mockResolvedValue(createdResponse({ number: 42 }))
    await expect(createGithubIssue(args(missingFields))).resolves.toMatchObject({ ok: false })
  })

  it('returns a failure (rather than throwing) when the network call rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))

    await expect(createGithubIssue(args(fetchImpl))).resolves.toMatchObject({
      ok: false,
      status: null,
    })
  })
})
