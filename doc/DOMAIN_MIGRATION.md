# Moving to activitymaxxer.moritzmarcus.com

`activitymaxxer.com` → `activitymaxxer.moritzmarcus.com`. The old domain becomes a 301
redirect to the new one and stays that way until it expires (~July 2027), then lapses.

The code half is done on this branch: the Worker's custom domain, every canonical /
`og:url` / JSON-LD / sitemap URL, the tile proxy's User-Agent and the user-facing copy all
name the new host. **Merging and deploying it is the cutover** — nothing below the
"Cutover" heading should happen before that deploy, and everything in it should happen
right after.

Budget ~30 minutes. The old domain is unreachable for the minute or two between the deploy
and step 3; that is accepted.

---

## Before cutover (any time, changes nothing for users)

- [ ] **Turnstile** → the existing widget → **Hostnames** → add
  `activitymaxxer.moritzmarcus.com`. Keep `activitymaxxer.com` for now. The site key does
  not change, so `.env` doesn't either. Without this the feedback form rejects every
  submission on the new host.
- [ ] **`moritzmarcus.com` zone → DNS**: confirm there is **no** existing record named
  `activitymaxxer`. A custom domain refuses to attach over one.
- [ ] **`moritzmarcus.com` zone → SSL/TLS → Edge Certificates → Always Use HTTPS** → on
  (same reasoning as A4 in [SEO_LAUNCH.md](SEO_LAUNCH.md)).
- [ ] **Search Console**: add and verify a property for the new host (or a Domain property
  for `moritzmarcus.com`). Keep the old property.

---

## Cutover

### 1. Merge and deploy

Merge the PR, then Actions → **Deploy** → Run workflow on `main` (or `npm run deploy`).

Afterwards, Workers & Pages → `activitymaxxer` → **Settings → Domains & Routes** must list
**only** `activitymaxxer.moritzmarcus.com`. If `activitymaxxer.com` is still attached,
remove it there — step 3 cannot add its DNS record while it is.

### 2. Strava

strava.com → Settings → **My API Application** (the production app, id `270832`):

- **Authorization Callback Domain** → `activitymaxxer.moritzmarcus.com`
- **Website** → `https://activitymaxxer.moritzmarcus.com`

A Strava app has exactly one callback domain, which is why this waits for the deploy.

### 3. The redirect on the old zone

Cloudflare → the **`activitymaxxer.com`** zone:

1. **DNS → Add record**: type `AAAA`, name `@`, IPv6 `100::`, **Proxied** (orange cloud).
   The address is a discard placeholder; the record only exists so requests reach
   Cloudflare's edge, where the rule below answers them.
2. **Rules → Redirect Rules → Create rule** (Single Redirect):

   | Field | Value |
   | --- | --- |
   | Rule name | `to activitymaxxer.moritzmarcus.com` |
   | When incoming requests match | Custom filter expression: `(http.host eq "activitymaxxer.com")` |
   | Then… URL redirect type | **Dynamic** |
   | Expression | `concat("https://activitymaxxer.moritzmarcus.com", http.request.uri.path)` |
   | Status code | **301** |
   | Preserve query string | **on** |

Why a dashboard rule and not code: static assets are served *before* the Worker runs, so a
redirect in `worker/index.js` would never see `/` or the prerendered pages. The rule also
costs no Worker requests and disappears with the zone.

What this preserves, for free:

- **Long share links** (`/#a=…`) — the fragment never reaches the server, and browsers
  re-attach it to a `Location` that has none.
- **Short share links** (`/s/<id>`) — redirected to the same path on the new host, where
  the Worker reads the same KV namespace and redirects into the app.

What it does not: saved intervals.icu API keys and Strava connections live in
`localStorage`, which is per-origin. Everyone appears signed out once on the new host and
reconnects. Reconnecting an athlete who was already connected does not use another of
Strava's 10 slots.

### 4. Verify

```bash
OLD=https://activitymaxxer.com
NEW=https://activitymaxxer.moritzmarcus.com

echo "== new host serves (expect 200 + title) =="
curl -s -o /dev/null -w '%{http_code}\n' $NEW/
curl -s $NEW/ | grep -o '<link rel="canonical"[^>]*>'

echo "== old host redirects, path + query kept (expect 301 → $NEW/fit-file-viewer?x=1) =="
curl -sI "$OLD/fit-file-viewer?x=1" | grep -iE '^(HTTP|location)'

echo "== old short link: 301 to new /s/, then 302 into the app =="
curl -sI $OLD/s/abcdefghij | grep -iE '^(HTTP|location)'

echo "== http:// on the new host (expect 301) =="
curl -sI http://activitymaxxer.moritzmarcus.com/ | head -1

echo "== sitemap + robots name the new host =="
curl -s $NEW/robots.txt
curl -s $NEW/sitemap.xml | grep -o '<loc>[^<]*</loc>'
```

In a browser, on the new host:

- [ ] Feedback → submit a test message → an issue appears (proves Turnstile accepts the host).
- [ ] Connect with Strava → consent → the activity list loads (proves the callback domain).
- [ ] Map background on → tiles load.

### 5. Tell the outside world

- [ ] **Search Console** → the *old* property → Settings → **Change of address** → the new
  property. Then submit `https://activitymaxxer.moritzmarcus.com/sitemap.xml` in the new one.
- [ ] GitHub repo → About → **Website**.
- [ ] Anywhere else you listed the URL (profiles, posts you can still edit).

---

## Until expiry

Leave the redirect alone. Google wants a site-move redirect in place for at least 180 days;
this one gets ~300. Glance at Search Console now and then: the old property's indexed pages
should drain into the new one.

About a month before expiry, decide once: **let it lapse**, or renew for a year purely to
keep old links working. Letting it lapse breaks every `activitymaxxer.com` link already
posted (short and long share links included), and a lapsed domain with inbound links tends
to be bought and re-served by someone else.

## At expiry

- [ ] Delete the `activitymaxxer.com` zone from Cloudflare.
- [ ] Turnstile widget → remove `activitymaxxer.com` from its hostnames.
- [ ] Mark this document done.
