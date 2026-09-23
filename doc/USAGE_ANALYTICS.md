# Usage analytics: anonymous counts, no identifiers

This doc covers how to tell whether anyone uses ActivityMaxxer and which parts are worth
maintaining, without going back on what `/about` promises.

## What is counted

Everything goes into one Workers Analytics Engine dataset, `activitymaxxer_usage` (binding
`USAGE` in `wrangler.jsonc`). There are two kinds of row, and both have the same layout:

| column    | `pageview` row                                                | `feature` row                        |
| --------- | ------------------------------------------------------------- | ------------------------------------ |
| `blob1`   | `'pageview'`                                                  | `'feature'`                          |
| `blob2`   | page path: `/`, `/about`, `/gpx-viewer`, `/s` (share link), … | feature id, e.g. `load:file`, `zoom` |
| `blob3`   | country, two letters (from Cloudflare's edge)                 | `''`                                 |
| `blob4`   | external referring **hostname** only, e.g. `reddit.com`      | `''`                                 |
| `blob5`   | `mobile` / `desktop`                                          | `mobile` / `desktop`                 |
| `double1` | `1`                                                           | `1`                                  |

- **Page views** are counted by the Worker itself (`worker/lib/usageAnalytics.js`), so no
  client code is involved. The Worker counts only browser navigations: GET requests with
  `Sec-Fetch-Dest: document`, a status under 400, and not a prefetch.
- **Feature use** comes from `src/lib/usage.js`. Components call `markUsed('zoom')`, which
  only adds the id to a Set in memory. When the tab is hidden or closed, the page sends one
  `navigator.sendBeacon('/api/usage', {"v":1,"f":[...]})`, and each feature is sent at most
  once per page load. The ids are a closed list in `shared/usageEvents.js`, and the Worker
  drops anything that is not on it.

### Feature ids

| id                                                             | set when                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `load:file` / `load:intervals` / `load:strava` / `load:shared` | an activity loaded successfully by that route                    |
| `load:error`                                                   | a load failed                                                    |
| `format:fit` / `format:tcx` / `format:gpx` / `format:sniffed`  | the extension of a dropped file (`sniffed` = name said nothing)  |
| `sport:running` / `sport:cycling` / `sport:track`              | the sport of a loaded activity                                   |
| `zoom`                                                         | the zoom window was narrowed                                     |
| `xaxis:distance`                                               | the x-axis was switched to distance                              |
| `metric:toggle`                                                | a metric panel was hidden or shown                               |
| `stats` / `derivative`                                         | a max/min/avg/median line, or a d/dt series, was toggled         |
| `map:hidden`                                                   | the route map was switched off                                   |
| `basemap`                                                      | a map background was switched on                                 |
| `export`                                                       | a trimmed window was downloaded                                  |
| `share`                                                        | the Share button was pressed                                     |
| `feedback:open`                                                | the feedback dialog was opened                                   |

Before adding an id, check it against the rule in `shared/usageEvents.js`: it has to be a
yes/no fact about the page load. It can't be a value, a name, or anything that could tell one
visitor from another.

## What is never recorded

- IP address. `/api/usage` uses `CF-Connecting-IP` as the rate limiter's bucket key and
  nothing else, and it is never written.
- User-Agent. It is reduced to one bit, mobile or desktop.
- Cookies, `localStorage`, or any other storage. Nothing is stored on the visitor's device.
- A visit, session, or visitor id. Rows can't be joined to each other, so the data can't
  reconstruct a path through the app, let alone a person.
- Share-link ids (`/s/<id>` is recorded as `/s`), referrer paths or query strings, filenames,
  or any number from an activity.
- Anything at all from a browser that sends Global Privacy Control or Do Not Track. The beacon
  is suppressed. A page view is still counted, because serving a page means seeing the request.

Analytics Engine deletes rows after three months.

**The trade-off:** there is no unique-visitor count, and there can't be one without an
identifier. App page views (`blob2 = '/'`) stand in for visits, and feature use is read as a
share of them.

## Setup

1. **Deploy.** Nothing needs provisioning, because the dataset is created on its first write.
   `wrangler.jsonc` already has the `USAGE` binding, the `USAGE_RATE_LIMITER`, and
   `assets.run_worker_first`.
2. **Create a read token.** In the Cloudflare dashboard, go to My Profile → API Tokens →
   Create Token → Custom, and give it the permission **Account → Account Analytics → Read**.
   The deploy token doesn't have this scope, and it shouldn't.
3. **Run the report:**

   ```bash
   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run usage       # last 30 days
   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run usage 90    # up to 90
   ```

   The report shows daily app page views, views per page, each feature's share of app page
   views, the mobile/desktop split, top countries, and top referring sites.

Local `npm run dev` never reaches the Worker, and `wrangler dev` writes to a local
simulator, so development never pollutes the numbers.

### Ad-hoc queries

The SQL API is `POST https://api.cloudflare.com/client/v4/accounts/<id>/analytics_engine/sql`
with the query as the body. Always total with `SUM(_sample_interval)` and never with
`COUNT()`: at high volume Analytics Engine samples rows and records how many each one
stands for.

```sql
-- Weekly app visits, to see the trend
SELECT toStartOfInterval(timestamp, INTERVAL '7' DAY) AS week, SUM(_sample_interval) AS visits
FROM activitymaxxer_usage
WHERE blob1 = 'pageview' AND blob2 = '/' AND timestamp > NOW() - INTERVAL '90' DAY
GROUP BY week ORDER BY week

-- Feature use on phones vs computers
SELECT blob2 AS feature, blob5 AS device, SUM(_sample_interval) AS n
FROM activitymaxxer_usage
WHERE blob1 = 'feature' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY feature, device ORDER BY n DESC
```

## Reading the numbers

- **Is anyone using it?** Look at daily app page views, and at how `load:*` compares with
  app page views. The share of visits where an activity was actually loaded matters more
  than raw views, because a visitor who bounces off the hero never used the app. A flat or
  growing number of loads per week means real use.
- **Which routes to keep?** Compare `load:file` / `load:intervals` / `load:strava` /
  `load:shared`, and `format:fit` / `tcx` / `gpx`. A route or parser that is near zero for
  90 days is a candidate for retirement. The Strava route in particular carries an API
  agreement and a server proxy.
- **Which features matter?** Each feature's percentage is the share of app visits that
  touched it at least once. A feature at 0.5% after three months is safe to stop polishing.
- **Where do people come from?** Use the referrer and `/about` / `/*-viewer` page views. The
  SEO pages' views next to Search Console's clicks show whether those pages lead into the app.
- **`load:error`** as a share of all `load:*` is the one number that should trigger work
  right away if it climbs.

### Known biases

- **Beacons are lost sometimes**, most often on mobile Safari when a tab is killed rather
  than backgrounded. Feature shares are a floor, not an exact figure.
- **Bots** that fake `Sec-Fetch-Dest: document` are counted as page views. They almost
  never send a beacon, so they deflate feature shares slightly and leave feature counts
  alone.
- **Rate-limited or GPC/DNT visitors** add page views without feature rows.
