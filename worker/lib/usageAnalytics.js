// Anonymous, aggregate usage counting into Workers Analytics Engine — the
// server half of doc/USAGE_ANALYTICS.md.
//
// **What a data point may carry, and what it never does.** Every row is one of
// two kinds, laid out identically so one SQL shape reads both:
//
//   blob1 kind     'pageview' | 'feature'
//   blob2 name     a page path ('/', '/about', '/s') or a feature id
//   blob3 country  two-letter, from Cloudflare's edge (pageview only)
//   blob4 referrer the referring *site's hostname*, external only (pageview only)
//   blob5 device   'mobile' | 'desktop'
//   double1        1 — every row counts once; sum `_sample_interval` for totals
//
// No IP address, no User-Agent string, no cookie, no path segment that names
// a thing (a share link's id becomes '/s'), no timestamp finer than the one
// Analytics Engine stamps itself, and no identifier of any kind — two rows
// from the same person are indistinguishable from two rows from two people.
// That is the point: the dataset can answer "how many" and "which", never
// "who" or "what did this visitor do next". Analytics Engine drops rows after
// three months on its own.
//
// **Fails open, silently.** No `USAGE` binding (local `wrangler dev` without
// the dataset, the test suite) means nothing is written; counting must never
// be the reason a page or an API call fails.

const PAGE_PATH = /^\/[a-z0-9-]{0,40}$/
const MAX_REFERRER_CHARS = 64

/**
 * A request is counted as a page view only when a browser is navigating a tab
 * to it: `Sec-Fetch-Dest: document`, which every current browser sends on a
 * top-level navigation and scripts, crawlers and prefetchers mostly do not.
 * That one header does most of the bot filtering a self-hosted counter can
 * honestly do.
 *
 * @param {Request} request
 */
export function isPageNavigation(request) {
  if (request.method !== 'GET') return false
  if (request.headers.get('sec-fetch-dest') !== 'document') return false
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? ''
  return !/prefetch|prerender/i.test(purpose)
}

/**
 * `/about.html`, `/about/` and `/about` are one page. A share link's id is
 * never kept — every `/s/<id>` is `/s`. Anything that is not a plain slug is
 * 'other', so a crafted URL cannot write arbitrary text into the dataset.
 *
 * @param {string} pathname
 */
export function normalizePagePath(pathname) {
  if (pathname.startsWith('/s/')) return '/s'
  const path = pathname.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1')
  return PAGE_PATH.test(path) ? path : 'other'
}

/**
 * The hostname of an *external* referrer, lower-cased and without `www.`, or
 * '' for none, same-site, or anything unparseable. Browsers already trim a
 * cross-site Referer to its origin by default; keeping only the hostname
 * drops even the scheme and port.
 *
 * @param {string|null} referer
 * @param {string} ownHostname
 */
export function referrerHost(referer, ownHostname) {
  if (!referer) return ''
  let hostname
  try {
    hostname = new URL(referer).hostname.toLowerCase()
  } catch {
    return ''
  }
  if (hostname === ownHostname.toLowerCase()) return ''
  return hostname.replace(/^www\./, '').slice(0, MAX_REFERRER_CHARS)
}

/**
 * One bit about the device, never the User-Agent itself. `Sec-CH-UA-Mobile`
 * where the browser sends it (Chromium); otherwise the conventional "Mobi"
 * substring check, which is what that client hint was designed to replace.
 *
 * @param {Headers} headers
 * @returns {'mobile'|'desktop'}
 */
export function deviceClass(headers) {
  const hint = headers.get('sec-ch-ua-mobile')
  if (hint === '?1') return 'mobile'
  if (hint === '?0') return 'desktop'
  return /Mobi|Android|iPhone|iPad/i.test(headers.get('user-agent') ?? '') ? 'mobile' : 'desktop'
}

/** @param {unknown} country */
function countryCode(country) {
  return typeof country === 'string' && /^[A-Z0-9]{2}$/.test(country) ? country : ''
}

/**
 * Counts a successful page navigation. Called for every request the Worker
 * sees; everything that is not a browser opening a page is ignored here.
 *
 * @param {{ USAGE?: { writeDataPoint: (point: object) => void } }} env
 * @param {Request} request
 * @param {Response} response
 */
export function recordPageView(env, request, response) {
  if (!env?.USAGE?.writeDataPoint) return
  if (response.status >= 400 || !isPageNavigation(request)) return

  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) return

  safeWrite(env.USAGE, {
    indexes: ['pageview'],
    blobs: [
      'pageview',
      normalizePagePath(url.pathname),
      countryCode(request.cf?.country),
      referrerHost(request.headers.get('referer'), url.hostname),
      deviceClass(request.headers),
    ],
    doubles: [1],
  })
}

/**
 * One row per feature id. Callers pass only ids that have already passed the
 * shared allowlist (routes/usage.js).
 *
 * @param {{ USAGE?: { writeDataPoint: (point: object) => void } }} env
 * @param {string[]} features
 * @param {'mobile'|'desktop'} device
 */
export function recordFeatures(env, features, device) {
  if (!env?.USAGE?.writeDataPoint) return
  for (const feature of features) {
    safeWrite(env.USAGE, {
      indexes: ['feature'],
      blobs: ['feature', feature, '', '', device],
      doubles: [1],
    })
  }
}

// writeDataPoint is synchronous and documented not to throw on the hot path,
// but a malformed point does throw — and a counting bug must not become a
// 500 on the page itself.
function safeWrite(dataset, point) {
  try {
    dataset.writeDataPoint(point)
  } catch {
    // Deliberately swallowed; see the header.
  }
}
