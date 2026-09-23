import { describe, expect, it } from 'vitest'
import {
  deviceClass,
  isPageNavigation,
  normalizePagePath,
  recordFeatures,
  recordPageView,
  referrerHost,
} from './usageAnalytics.js'

function makeEnv() {
  const points = []
  return { points, USAGE: { writeDataPoint: (point) => points.push(point) } }
}

function navigation(path, headers = {}, cf) {
  const request = new Request(`https://activitymaxxer.com${path}`, {
    headers: { 'sec-fetch-dest': 'document', ...headers },
  })
  // workerd attaches `cf`; Node's Request has no such property.
  if (cf) Object.defineProperty(request, 'cf', { value: cf })
  return request
}

const ok = new Response('ok')

describe('recordPageView', () => {
  it('writes one anonymous row per page navigation', () => {
    const env = makeEnv()
    recordPageView(
      env,
      navigation('/about', {
        referer: 'https://www.reddit.com/r/running/comments/abc',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
        'cf-connecting-ip': '203.0.113.7',
      }, { country: 'DK' }),
      ok,
    )
    expect(env.points).toEqual([
      {
        indexes: ['pageview'],
        blobs: ['pageview', '/about', 'DK', 'reddit.com', 'mobile'],
        doubles: [1],
      },
    ])
    // Nothing identifying survives into the row.
    expect(JSON.stringify(env.points)).not.toMatch(/203\.0\.113\.7|iPhone|comments/)
  })

  it('never keeps a share link id', () => {
    const env = makeEnv()
    recordPageView(env, navigation('/s/AbCdEf1234'), new Response(null, { status: 302 }))
    expect(env.points[0].blobs[1]).toBe('/s')
  })

  it.each([
    ['a script or crawler (no Sec-Fetch-Dest)', new Request('https://activitymaxxer.com/'), ok],
    ['a subresource', navigation('/favicon.svg', { 'sec-fetch-dest': 'image' }), ok],
    ['a prefetch', navigation('/about', { 'sec-purpose': 'prefetch' }), ok],
    ['a 404', navigation('/nope'), new Response('', { status: 404 })],
    ['an API path', navigation('/api/strava/callback'), ok],
  ])('ignores %s', (_, request, response) => {
    const env = makeEnv()
    recordPageView(env, request, response)
    expect(env.points).toEqual([])
  })

  it('does nothing, and does not throw, without the binding', () => {
    expect(() => recordPageView({}, navigation('/'), ok)).not.toThrow()
  })

  it('swallows a failing write rather than failing the page', () => {
    const env = { USAGE: { writeDataPoint: () => { throw new Error('bad point') } } }
    expect(() => recordPageView(env, navigation('/'), ok)).not.toThrow()
  })
})

describe('recordFeatures', () => {
  it('writes one row per feature, with no country or referrer', () => {
    const env = makeEnv()
    recordFeatures(env, ['load:file', 'zoom'], 'desktop')
    expect(env.points.map((p) => p.blobs)).toEqual([
      ['feature', 'load:file', '', '', 'desktop'],
      ['feature', 'zoom', '', '', 'desktop'],
    ])
  })
})

describe('helpers', () => {
  it.each([
    ['/', '/'],
    ['/index.html', '/'],
    ['/about', '/about'],
    ['/about/', '/about'],
    ['/about.html', '/about'],
    ['/gpx-viewer', '/gpx-viewer'],
    ['/s/xyz', '/s'],
    ['/some/nested/path', 'other'],
    ['/<script>', 'other'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePagePath(input)).toBe(expected)
  })

  it('keeps only an external referrer hostname', () => {
    expect(referrerHost('https://news.ycombinator.com/item?id=1', 'activitymaxxer.com')).toBe('news.ycombinator.com')
    expect(referrerHost('https://activitymaxxer.com/about', 'activitymaxxer.com')).toBe('')
    expect(referrerHost('not a url', 'activitymaxxer.com')).toBe('')
    expect(referrerHost(null, 'activitymaxxer.com')).toBe('')
  })

  it('reduces the device to one bit, preferring the client hint', () => {
    expect(deviceClass(new Headers({ 'sec-ch-ua-mobile': '?1' }))).toBe('mobile')
    expect(deviceClass(new Headers({ 'sec-ch-ua-mobile': '?0', 'user-agent': 'Android Mobi' }))).toBe('desktop')
    expect(deviceClass(new Headers({ 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Mobile' }))).toBe('mobile')
    expect(deviceClass(new Headers({ 'user-agent': 'Mozilla/5.0 (Macintosh)' }))).toBe('desktop')
  })

  it('only counts GET navigations', () => {
    expect(isPageNavigation(navigation('/'))).toBe(true)
    expect(
      isPageNavigation(new Request('https://a.b/', { method: 'POST', headers: { 'sec-fetch-dest': 'document' } })),
    ).toBe(false)
  })
})
