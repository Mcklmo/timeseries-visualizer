#!/usr/bin/env node
// `npm run usage [days]` — prints the anonymous usage totals the Worker writes
// to Workers Analytics Engine (worker/lib/usageAnalytics.js). The answer to
// "is anyone using this, and which parts?" without opening a dashboard.
//
// Needs two environment variables:
//   CLOUDFLARE_ACCOUNT_ID  the account the Worker is deployed to
//   CLOUDFLARE_API_TOKEN   a token with Account → Account Analytics → Read
// Neither is the deploy token's scope; see doc/USAGE_ANALYTICS.md.
//
// Every total is SUM(_sample_interval), never COUNT(): Analytics Engine
// samples at high volume and records how many rows each stored row stands for.

export const DATASET = 'activitymaxxer_usage'

/** @param {number} days */
export function reportQueries(days) {
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`
  const total = 'SUM(_sample_interval)'
  return {
    daily: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ${total} AS n FROM ${DATASET} WHERE blob1 = 'pageview' AND blob2 = '/' AND ${since} GROUP BY day ORDER BY day`,
    pages: `SELECT blob2 AS name, ${total} AS n FROM ${DATASET} WHERE blob1 = 'pageview' AND ${since} GROUP BY name ORDER BY n DESC`,
    countries: `SELECT blob3 AS name, ${total} AS n FROM ${DATASET} WHERE blob1 = 'pageview' AND ${since} GROUP BY name ORDER BY n DESC LIMIT 15`,
    referrers: `SELECT blob4 AS name, ${total} AS n FROM ${DATASET} WHERE blob1 = 'pageview' AND blob4 != '' AND ${since} GROUP BY name ORDER BY n DESC LIMIT 15`,
    devices: `SELECT blob5 AS name, ${total} AS n FROM ${DATASET} WHERE blob1 = 'pageview' AND blob2 = '/' AND ${since} GROUP BY name ORDER BY n DESC`,
    features: `SELECT blob2 AS name, ${total} AS n FROM ${DATASET} WHERE blob1 = 'feature' AND ${since} GROUP BY name ORDER BY n DESC`,
  }
}

const num = (value) => Number(value) || 0

/**
 * @param {{ name: string, n: number|string }[]} rows
 * @param {number} [denominator] when given, each row also shows its share of it
 */
export function formatTable(rows, denominator) {
  if (rows.length === 0) return '  (none)'
  const width = Math.max(...rows.map((row) => String(row.name || '(unknown)').length))
  return rows
    .map((row) => {
      const label = String(row.name || '(unknown)').padEnd(width)
      const count = String(Math.round(num(row.n))).padStart(7)
      const share = denominator ? `  ${((100 * num(row.n)) / denominator).toFixed(1).padStart(5)}%` : ''
      return `  ${label}  ${count}${share}`
    })
    .join('\n')
}

/**
 * @param {Record<keyof ReturnType<typeof reportQueries>, {name?: string, day?: string, n: number|string}[]>} results
 * @param {number} days
 */
export function formatReport(results, days) {
  const appViews = num(results.pages.find((row) => row.name === '/')?.n)
  const daily = results.daily.map((row) => ({ name: String(row.day).slice(0, 10), n: row.n }))
  return [
    `ActivityMaxxer usage, last ${days} days (anonymous totals)`,
    '',
    `App page views: ${Math.round(appViews)}  (≈ ${(appViews / days).toFixed(1)}/day)`,
    '',
    'App page views per day',
    formatTable(daily),
    '',
    'Page views by page',
    formatTable(results.pages),
    '',
    'Features used — share of app page views that touched each at least once',
    formatTable(results.features, appViews || undefined),
    '',
    'Device (app page views)',
    formatTable(results.devices, appViews || undefined),
    '',
    'Top countries (all pages)',
    formatTable(results.countries),
    '',
    'Top referring sites (all pages)',
    formatTable(results.referrers),
  ].join('\n')
}

async function runQuery(sql, { accountId, token }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: sql },
  )
  const text = await response.text()
  if (!response.ok) throw new Error(`Analytics Engine SQL API ${response.status}: ${text}`)
  return JSON.parse(text).data ?? []
}

async function main() {
  const days = Number(process.argv[2] ?? 30)
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !token || !Number.isInteger(days) || days < 1 || days > 90) {
    console.error('usage: CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run usage [days 1-90]')
    process.exit(1)
  }
  const queries = reportQueries(days)
  const entries = await Promise.all(
    Object.entries(queries).map(async ([key, sql]) => [key, await runQuery(sql, { accountId, token })]),
  )
  console.log(formatReport(Object.fromEntries(entries), days))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
