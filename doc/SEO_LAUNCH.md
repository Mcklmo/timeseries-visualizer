# Launching ActivityMaxxer in search — what's left

The code is done, committed (`292228c`), and deployed. `activitymaxxer.com` is live and
serving the new build. What remains is dashboard work, external tools and link building,
spread over days to weeks.

Budget ~2 hours of active work, then a fortnight of waiting.

---

## Read this first

**This document is the entry point.** It is written so you do not have to explore the
codebase to work the list below. Run the audit block, then work the items in order.

**What not to read:**

| File | Why not |
| --- | --- |
| `doc/ARCHITECTURE.md` | 627 lines about the app's internals. Nothing in this runbook touches them. Only open it if you end up editing page *prose* and need to check a factual claim. |
| `README.md` | 528 lines. **One section is relevant** — "Static pages (`/about` and the format landing pages)". Skip the rest. |
| `scripts/seo/pages.mjs` | 424 lines of page copy. Only for content edits (item E), not for launch. |
| `doc/FEEDBACK_SETUP.md` | The setup it describes is done. It is the *tone* model for this doc, not a dependency. Its lint note names the wrong file; see the bottom of this page. |

**The one sequencing trap.** Renaming the Worker in `wrangler.jsonc` (`activity-visualizer`
→ `activitymaxxer`) created a **new** Worker. Secrets do not follow a rename. So:

- the new Worker has **no secrets**, which means **the feedback form on the live site is
  broken right now**; and
- the old Worker is **still deployed**, serving the stale pre-rebrand build on its
  `workers.dev` subdomain — a live duplicate-content hostname, exactly what
  `workers_dev: false` exists to prevent.

You cannot fix the second one first. The old Worker is the **only place the production
`TURNSTILE_SECRET_KEY` still exists** in a form you can look at — and you can't read it back
out of Cloudflare either, so it has to be re-copied from the Turnstile dashboard before the
old Worker goes away. Hence: **provision secrets → verify the form works → then delete.**

---

## Audit block

**Snapshot date: 2026-08-08.** Everything below was true then. Re-run this block before
starting; **where it disagrees with the table, the block is right and the table has rotted.**

```bash
cd "$(git rev-parse --show-toplevel)"

echo "== NS delegation (expect koa + yolanda .ns.cloudflare.com) =="
dig +short NS activitymaxxer.com

echo "== apex (expect 200 + the ActivityMaxxer title) =="
curl -s -o /dev/null -w '%{http_code}\n' https://activitymaxxer.com/
curl -s https://activitymaxxer.com/ | grep -o '<title>[^<]*</title>'

echo "== all five URLs + assets (expect 200, and 404 for /nope) =="
for p in /about /fit-file-viewer /tcx-file-viewer /gpx-viewer /sitemap.xml /robots.txt /og.png /nope; do
  printf '%-18s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://activitymaxxer.com$p)"
done

echo "== robots.txt (expect OUR body: Allow: / + our Sitemap line) =="
curl -s https://activitymaxxer.com/robots.txt

echo "== http:// (301 once A4 is done; 200 means it is NOT) =="
curl -s -o /dev/null -w '%{http_code}\n' http://activitymaxxer.com/

echo "== new workers.dev (expect 404 — workers_dev: false) =="
curl -s -o /dev/null -w '%{http_code}\n' https://activitymaxxer.moritzhoenscheidt.workers.dev/

echo "== OLD workers.dev (expect 000/404 once A3 is done; 200 means the orphan is live) =="
curl -s -o /dev/null -w '%{http_code}\n' https://activity-visualizer.moritzhoenscheidt.workers.dev/

echo "== www (expect empty = NXDOMAIN) =="
dig +short www.activitymaxxer.com

echo "== secrets on the live Worker (expect BOTH once A1 is done) =="
npx wrangler secret list --name activitymaxxer

echo "== secrets on the orphan (expect an error once A3 is done) =="
npx wrangler secret list --name activity-visualizer
```

### What it returned on 2026-08-08

| Check | Result |
| --- | --- |
| NS delegation | `koa` / `yolanda.ns.cloudflare.com` — zone active |
| `https://activitymaxxer.com/` | 200, `<title>ActivityMaxxer — FIT, TCX &amp; GPX File Viewer in Your Browser</title>` |
| `/about`, `/fit-file-viewer`, `/tcx-file-viewer`, `/gpx-viewer` | all 200 |
| `/sitemap.xml`, `/robots.txt`, `/og.png` | all 200 |
| `robots.txt` body | **ours** — Cloudflare's managed content-signals file did not override or append |
| `/nope` | 404 — real 404s preserved |
| `activitymaxxer.…workers.dev` | 404 — `workers_dev: false` took effect |
| `www.activitymaxxer.com` | NXDOMAIN |
| `http://activitymaxxer.com/` | **200, not a 301** — Always Use HTTPS is off → **A4** |
| `activity-visualizer.…workers.dev` | **200, `<title>activity visualizer</title>`** — stale orphan → **A3** |
| secrets on `activitymaxxer` | **`[]`** — feedback form broken → **A1** |
| secrets on `activity-visualizer` | `GITHUB_TOKEN`, `TURNSTILE_SECRET_KEY` |

**Where the secret values are.** `GITHUB_TOKEN` is recoverable — it is in `.local.env` and
`.dev.vars` (both gitignored). `TURNSTILE_SECRET_KEY` is **not**: `.dev.vars` holds
Cloudflare's `1x…` *test* secret, which is correct for local dev and wrong for production.
The production value has to be re-copied from the Turnstile dashboard.

`VITE_TURNSTILE_SITE_KEY` in `.env` is already the **real production key** (`0x4AAAAA…`).
Only the comment above it is stale — see item F. Do not "fix" the value.

---

## A — Origin hygiene

**Blocks everything else. Do this first, in this order.**

### A1. Provision the two secrets on the new Worker — *you, in a terminal*

```bash
npx wrangler secret put GITHUB_TOKEN         # value: GITHUB_TOKEN in .local.env
npx wrangler secret put TURNSTILE_SECRET_KEY # value: Cloudflare → Turnstile → widget → Settings
```

Both prompt interactively and target the Worker named in `wrangler.jsonc`, which is now
`activitymaxxer` — no `--name` needed, but passing it does no harm.

For the Turnstile secret: the dashboard shows the **Secret Key** on the widget's settings
page, not on the widget list. Do not use the `1x…` value from `.dev.vars`; that is the test
secret, and it will reject every real token.

Verify:

```bash
npx wrangler secret list --name activitymaxxer
```

**Done when** both `GITHUB_TOKEN` and `TURNSTILE_SECRET_KEY` are listed **and** the smoke
test below passes.

### A2. Confirm the Turnstile widget's hostname allowlist — *you, in a dashboard*

Cloudflare → **Turnstile** → your widget → **Settings** → **Hostnames**. It must contain
`activitymaxxer.com`. The widget was created when the site served from a `workers.dev`
hostname; the origin has changed since. A hostname mismatch fails the challenge silently
from the user's point of view — the form just refuses to submit.

**Smoke test, which covers A1 and A2 together:** open <https://activitymaxxer.com>, click
**Feedback** in the footer, submit a real message. Expect "Thanks — your feedback was filed
as issue #N" with a working link, and the issue present on `Mcklmo/timeseries-visualizer`,
labelled `feedback`. Delete the test issue afterwards.

If it fails, `npx wrangler tail` streams the live Worker log and prints the real reason —
the route deliberately tells the browser only a generic message. "The verification challenge
could not be confirmed" means Turnstile: wrong secret (A1) or wrong hostname (A2). A 502
means GitHub: bad or expired token.

**No redeploy is needed for either.** Worker secrets are read at runtime.
(`VITE_TURNSTILE_SITE_KEY` *is* build-time and would need one — but you are not changing it.)

### A3. Delete the orphaned Worker — *you, in a terminal, after A1 passes*

> **Destructive and irreversible.** It deletes the Worker and every secret on it.
> **Do not run this until the A1/A2 smoke test has actually passed** — the orphan is the last
> place the production Turnstile secret exists. If you delete it first and the value is not
> in the Turnstile dashboard for some reason, the form stays broken until you regenerate the
> widget's secret, which invalidates the old one.
>
> **An agent must not run this without asking you first.**

```bash
npx wrangler delete --name activity-visualizer
```

Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://activity-visualizer.moritzhoenscheidt.workers.dev/
```

**Done when** that returns `000` (DNS gone) or `404`, not `200`. Propagation can take a
minute or two.

Why it matters: it currently serves a byte-different but substantively identical site on an
indexable hostname. Google resolves duplicates by picking one — and there is no canonical
tag pointing home from that build, because it predates the rebrand.

### A4. Enable Always Use HTTPS — *you, in a dashboard*

Cloudflare → the `activitymaxxer.com` zone → **SSL/TLS** → **Edge Certificates** → **Always
Use HTTPS** → on.

Right now `http://activitymaxxer.com/` returns **200**, not a redirect. That is a second
scheme serving the same content, and it means every plain-`http` inbound link leaks its
referrer and spends a redirect-free crawl on the wrong URL.

Verify:

```bash
curl -sI http://activitymaxxer.com/ | head -1   # expect: HTTP/1.1 301 Moved Permanently
```

**Only after that is confirmed 301**, consider HSTS (same page, **HTTP Strict Transport
Security**). HSTS with a long max-age is effectively irreversible for the duration — browsers
cache the policy, so a broken certificate later locks visitors out rather than degrading.
Start with a short max-age if you enable it at all. It is not required for launch.

### A5. Decide about `www` — *you, in a dashboard, or explicitly not*

`www.activitymaxxer.com` is **NXDOMAIN** today. That is a valid end state, and it is the
option the plan called simplest — nothing to configure, nothing to keep in sync.

The cost: someone typing `www.` gets a DNS error rather than your site. Whether that matters
is a judgement call about your audience.

If you want it to resolve, the **only** correct shape is: a proxied placeholder record for
`www` plus a **Redirect Rule** to the apex (301, preserve path and query).

> **Never attach `www` as a second custom domain in `wrangler.jsonc`.** That would serve the
> same bytes on two hostnames whose canonical tags, `og:url` and sitemap all point at the
> apex — the exact duplicate-content split that `workers_dev: false` was added to close.

**Done when** you have either written down "leaving `www` unresolved, deliberate" or verified
`curl -sI https://www.activitymaxxer.com/` returns 301 to the apex.

---

## B — Search Console

*You, in a dashboard. Needs A1–A4 done, so Google's first crawl sees the final shape.*

1. **Add a Domain property** at <https://search.google.com/search-console> — choose
   **Domain** (not URL prefix); it covers every scheme and subdomain at once, which is what
   you want given A4 and A5.
2. It gives you a **TXT record**. Add it in Cloudflare → the zone → **DNS** → **Add record**
   → type `TXT`, name `@`, content as given. Verification usually lands within a minute.
3. **Sitemaps** → submit `https://activitymaxxer.com/sitemap.xml`. Expect "Success" and 5
   discovered URLs.
4. **URL Inspection** on `https://activitymaxxer.com/` → **Test live URL** → **View crawled
   page** → **Screenshot** / **HTML**.

   **This is the one check with real risk attached.** The home page is the only
   client-rendered page on the site; the other four are static HTML with no JavaScript.
   If Google's render shows an empty shell, the home page's content is invisible to search
   and the four static pages are carrying the site alone. They exist precisely as that
   hedge — so this is a "how much did we need the hedge" test, not a launch blocker.
5. **Bing Webmaster Tools** (<https://www.bing.com/webmasters>) → **Import from Google Search
   Console**. Two clicks, and it covers Bing plus DuckDuckGo's index.

**Done when** the property is verified, the sitemap reads 5 URLs discovered, and you have
looked at the rendered home page with your own eyes.

---

## C — Validation

*You, in a browser. Independent of B; can run in parallel.*

| Tool | URL to test | Expect |
| --- | --- | --- |
| [Rich Results Test](https://search.google.com/test/rich-results) | `https://activitymaxxer.com/` | `SoftwareApplication` detected, no errors |
| Rich Results Test | `https://activitymaxxer.com/fit-file-viewer` | `FAQPage`, 4 questions, no errors |
| [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) | `https://activitymaxxer.com/` | og:image renders as a 1200×630 card |
| Twitter/X card validator | `https://activitymaxxer.com/` | `summary_large_image` |
| [PageSpeed Insights](https://pagespeed.web.dev/) | `https://activitymaxxer.com/fit-file-viewer` | ~100 across the board |

The PageSpeed number on `/fit-file-viewer` should be close to perfect — it is static HTML
with a single stylesheet and no JavaScript at all. If it is not, something is linking a
bundle that should not be. Running it on `/` instead measures the React app, which is a
different (and less flattering) question; do that only if you want the baseline.

The other three landing pages carry the same `FAQPage` shape as `/fit-file-viewer`. Testing
one is enough unless you have edited the others.

---

## D — Links

*You, posting as yourself. **An agent posts nothing on your behalf** — these are your
accounts and your reputation.*

This is the part that decides whether any of the rest matters. Five well-written pages with
no inbound links rank nowhere. Post in this order: the friendliest audience first, so you
learn how the pitch lands before it reaches the harshest one.

### D0. GitHub repo About field — *2 minutes, do it now*

github.com/Mcklmo/timeseries-visualizer → the gear icon next to **About**:

- **Description:** `Open FIT, TCX and GPX files in your browser and see pace, HR, cadence, power and elevation as stacked, time-synced charts. Nothing is uploaded.`
- **Website:** `https://activitymaxxer.com`
- **Topics:** `fit`, `tcx`, `gpx`, `garmin`, `cycling`, `running`, `data-visualization`, `privacy`

The README header link is already done. This one is a `rel="nofollow"` link, so it passes no
ranking signal directly — but it is how anyone arriving at the repo finds the site, and
GitHub repos surface in search for the format queries themselves.

### D1. intervals.icu forum — *lead with the integration*

<https://forum.intervals.icu>, in the section for third-party tools. This is the warmest
audience: they already use the thing your app connects to.

> **Subject:** A browser-based FIT/TCX/GPX chart viewer that reads from intervals.icu
>
> I built a small viewer for activity files — you open a .fit, .tcx or .gpx and it draws
> pace, heart rate, cadence, power and elevation as stacked charts on a shared time axis,
> with a crosshair that reads across all of them at once.
>
> The reason I'm posting it here: it talks to intervals.icu directly. Paste your API key
> (Settings → Developer Settings) and you can browse and search your whole history by
> activity name, then open any activity's original file straight into the charts — Stryd
> power and all, since intervals.icu serves the file you uploaded rather than normalized
> samples.
>
> That path exists mostly because of phones. Getting a watch file into a mobile browser is
> awkward, but intervals.icu already auto-syncs from Garmin, so on a phone it's paste the
> key once and everything is there.
>
> The browser talks to intervals.icu directly — the key and the files never pass through my
> server, which serves nothing but the page. Free, no account, no upload.
>
> https://activitymaxxer.com
>
> Happy to take feature requests; there's a feedback link in the footer that files a GitHub
> issue.

*Caveat worth knowing before you post:* Strava-synced activities can't be downloaded from
intervals.icu — it doesn't keep an original file for those. Say so if asked; don't lead with
it.

### D2. Reddit — *lead with privacy and the phone workflow*

Best fits: r/Garmin, r/running, r/cycling, r/Strava. **One subreddit at a time, a few days
apart** — simultaneous cross-posting reads as spam and gets caught by it. Check each
subreddit's self-promotion rule first; several require you to be a participating member.

> **Title:** I made a free FIT/TCX/GPX viewer that runs entirely in your browser — nothing gets uploaded
>
> Every "open my .fit file" site I could find wanted an upload and an account. This one
> doesn't: you drop the file in and JavaScript in your own tab parses it. There is no upload
> progress bar because there is no upload, no file size limit because no server sees the
> file, and closing the tab discards everything — there is nothing to delete because nothing
> was written anywhere. It also keeps working with the network off once the page has loaded.
>
> What you get: pace, heart rate, cadence, power and elevation as stacked charts on one time
> axis, with a crosshair that reads all of them at the same moment, plus pinch-zoom on
> mobile.
>
> If your watch syncs to intervals.icu you can connect it and browse your history instead of
> hunting for files — useful on a phone, where a .fit file isn't something you can easily
> browse to. That connection is opt-in and your browser talks to intervals.icu directly.
>
> https://activitymaxxer.com — free, no account, no ads, no analytics.

### D3. Show HN — *lead with the architecture*

<https://news.ycombinator.com/submit>. Post on a weekday morning US time. **Be around for
the first two hours** — an unanswered thread dies.

> **Title:** Show HN: ActivityMaxxer – FIT/TCX/GPX viewer that runs entirely client-side
>
> **URL:** https://activitymaxxer.com

First comment, posted by you immediately after submitting:

> Author here. This parses Garmin FIT, TCX and GPX files entirely in the browser — no
> upload, no accounts, no analytics, no cookies. The server serves the page and nothing
> else; the one API route it has files feedback as a GitHub issue.
>
> The FIT parsing uses Garmin's own SDK in the tab. Everything normalizes to one internal
> sample shape, so a GPX with nothing but lat/lon/ele/time still gets a speed and elevation
> chart derived from position, while a FIT from a Stryd pod brings running power through
> untouched. Charts share a time axis with a crosshair that reads across all of them.
>
> The one genuinely interesting architectural bit: the source of activities is a port with
> file adapters and an intervals.icu adapter, and adding the network one needed no
> server-side code at all — intervals.icu sends CORS headers, so the browser calls it
> directly and the API key never touches my infrastructure.
>
> Source: https://github.com/Mcklmo/timeseries-visualizer

Expect HN to interrogate the privacy claim. The honest answer is on `/about` and it is
precise: two things reach the network, both opt-in — the feedback form (posts to GitHub as a
public issue, guarded by Turnstile, which loads only when you open the dialog) and the
intervals.icu connection. Nothing else. Don't overstate it in the thread; the page doesn't.

---

## E — Ongoing

**At ~2 weeks**, in Search Console:

1. **Indexing → Pages.** All 5 URLs should be indexed. If a page sits in "Discovered –
   currently not indexed", that is normal for a new site and means *wait*, not *act*. If one
   is "Duplicate without user-selected canonical", something is serving a second copy — go
   back and re-run the audit block, particularly the old-Worker line.
2. **Performance.** Filter to queries containing `fit`, `tcx`, `gpx`. You are looking for
   impressions, not clicks — impressions mean Google has decided the page is a candidate,
   which is the first thing that has to be true.

**How to read that report:** deepen the pages that already get impressions rather than adding
new ones. A page showing up for a query it answers weakly is a page that will reward another
300 words; a sixth landing page with no demand behind it is just more surface to dilute. Prose
lives in `scripts/seo/pages.mjs` and `npm test` enforces the content rules on it — see
Guardrails.

---

## F — Housekeeping

**Fix the stale comment in `.env`.** The block above `VITE_TURNSTILE_SITE_KEY` says the value
is Cloudflare's "always passes" test key and carries a `TODO(owner)` to replace it. It is
actually the real production site key (`0x4AAAAA…`) — the replacement already happened and
the comment didn't follow. As written it invites the next reader to swap a working production
key for a test one.

Keep the first paragraph (why a site key is committed at all — it is public by design and
ships in the page HTML); delete the `TODO(owner)` paragraph and say plainly that this is the
production key for the `activitymaxxer.com` widget, and that local dev uses the paired test
*secret* in `.dev.vars`.

Doc-and-comment only. `npm test` and `npm run build` must still pass unchanged.

---

## File map

Everything this runbook can touch, so you never have to grep:

| Path | What it is |
| --- | --- |
| `scripts/seo/pages.mjs` | **All page prose**, as plain data — including the About copy, which is no longer a React component. Titles, descriptions, body HTML, FAQ entries. |
| `scripts/build-seo-pages.mjs` | The emitter. Runs after `vite build` (order matters: Vite empties `dist/`) and writes the four static pages plus `sitemap.xml` and `robots.txt` into `dist/`. |
| `scripts/seo/pages.test.mjs` | The content rules, enforced rather than reviewed — word count, vocabulary overlap, title/description lengths, the privacy phrasing, FAQ plain-text. |
| `index.html` | The app shell's `<head>`: title, description, canonical, OG/Twitter tags, `SoftwareApplication` JSON-LD. The static pages carry their own head from the emitter — **the two must agree on brand, origin and og:image, so change them together.** |
| `wrangler.jsonc` | `routes` (apex as custom domain), `workers_dev: false`, the Worker `name`, vars, rate limit. |
| `public/og.png` | The 1200×630 social card. Also `favicon.svg`, `apple-touch-icon.png`, `icon-512.png`. |
| `.env` | `VITE_TURNSTILE_SITE_KEY` — committed, build-time, public by design. |
| `.local.env`, `.dev.vars` | Gitignored. Where `GITHUB_TOKEN` is recoverable from. |

The five URLs, for reference: `/`, `/about`, `/fit-file-viewer`, `/tcx-file-viewer`,
`/gpx-viewer`. `sitemap.xml` and `robots.txt` are generated from that same list, so they
cannot drift from what exists.

---

## Guardrails

Decisions that are load-bearing and easy to undo by accident.

- **Never set `not_found_handling: "single-page-application"`** in `wrangler.jsonc`. It is
  the tempting default once you add routes, and it would answer every typo'd URL with 200 +
  the app shell — soft 404s at scale. Real 404s work today; `/nope` is in the audit block for
  exactly this reason.
- **Never add an analytics script.** `/about` states there is none, and a test pins that
  claim. Search performance is measured through Search Console, which reports from Google's
  own crawl logs and puts no code on the page. Adding one makes that page a lie.
- **The 400-word floor and the vocabulary-overlap ceiling in `pages.test.mjs` are the
  doorway-page rule.** If an edit fails them, the edit is wrong — do not relax the
  thresholds. Pages differing only in a filename get algorithmically filtered, leaving the
  site worse off than one good page would.
- **The CSS href in the emitter is globbed, never hardcoded.** Vite content-hashes the
  bundle every build; a pinned href yields an unstyled page rather than an error, which is
  the kind of breakage nobody notices.
- **The apex is the sole canonical origin.** Every canonical tag, `og:url` and sitemap entry
  hardcodes `https://activitymaxxer.com` with no trailing slash, and `pages.test.mjs` asserts
  it. `workers_dev: false` lives in `wrangler.jsonc` and not the dashboard because toggling
  it in the UI is undone by the next `wrangler deploy`.
- **`public/og.png` is generated art built from real fixture data, not a screenshot.**
  Swapping in a true screenshot later is a one-file replace — same path, 1200×630, and both
  `index.html` and the emitter already point at it by absolute URL. Note that the generator
  is **not in the repo and not described anywhere**: if you want to regenerate rather than
  replace, you are writing it fresh.

---

## Notes on verification

- `npm test` — 673 tests, all passing.
- `npm run build` — clean.
- `npm run lint` — **one pre-existing failure**, `src/ui/usePinchZoom.js:320`
  (`react-hooks/exhaustive-deps` rule not found — an ESLint plugin/config version problem).
  It predates this work and is unrelated to anything here. *(`doc/FEEDBACK_SETUP.md` names
  `src/stats/useMetricStats.js` for this; that reference is stale — the failure moved with
  the code. Same root cause.)* ESLint is also configured for `**/*.{ts,tsx}` only, so none of
  the project's `.js`/`.jsx` — including all of `worker/` and `scripts/` — is linted at all.
