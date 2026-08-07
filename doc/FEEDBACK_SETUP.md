# Shipping the feedback form — what's left

The code is done, tested, and smoke-tested against the real Workers runtime.
What remains is the part that can only happen in dashboards and a terminal you
own: two external accounts to configure, one deploy, and a browser walkthrough.

Budget ~30 minutes. Steps 1–2 are independent of each other; step 3 onwards is
strictly ordered.

---

## Read this first: the one sequencing trap

`VITE_TURNSTILE_SITE_KEY` is a **build-time** value — Vite inlines it into the
JS bundle. It is not read at runtime like the Worker's secrets are.

So changing `.env` does nothing until you **rebuild and redeploy**. And a
Turnstile widget is tied to specific hostnames, which means you generally need
to know your deployed hostname *before* you can create the widget. Hence the
order below: deploy once with the test key, then create the real widget, then
redeploy.

If you skip the second deploy, the site will load fine and the form will fail
on submit with "The verification challenge could not be confirmed" — because
the page is minting test-key tokens that your real secret refuses. That is the
intended fail-closed behaviour, not a bug.

---

## 1. GitHub: label + token

**1a. Create the `feedback` label** — repo → **Issues** → **Labels** → **New
label** → name it exactly `feedback`, any colour.

Do this even though the API *may* create labels on the fly: relying on
auto-creation is an untested assumption, and it may need permissions beyond the
"Issues: write" scope you're about to grant. One minute now removes the
question. (Also confirm Issues are enabled at all: repo → **Settings** →
**Features** → **Issues**.)

**1b. Create a fine-grained personal access token** — github.com → your avatar
→ **Settings** → **Developer settings** → **Personal access tokens** →
**Fine-grained tokens** → **Generate new token**.

| Field | Value |
| --- | --- |
| Resource owner | `Mcklmo` |
| Repository access | **Only select repositories** → `timeseries-visualizer` |
| Repository permissions | **Issues: Read and write** — nothing else |
| Expiration | Your call, but see the warning below |

Everything else stays at its default of "No access". The token starts with
`github_pat_`. Copy it now; GitHub won't show it again.

> **On expiration:** when this token expires, the form starts returning 502 and
> the only visible symptom is "Could not file the issue right now" in the
> dialog. Nothing alerts you. Either pick a long expiry and set a calendar
> reminder, or accept that you'll rediscover it the day someone tries to report
> a bug. `npx wrangler tail` shows the real reason in the Worker log.

---

## 2. Cloudflare: authenticate Wrangler

```bash
npx wrangler login
```

Opens a browser OAuth flow. Verify it picked the right account:

```bash
npx wrangler whoami
```

---

## 3. First deploy (with the test key — expected to be half-working)

```bash
npm run deploy
```

This builds and uploads the Worker plus `dist/`. It prints a URL like
`https://activity-visualizer.<your-subdomain>.workers.dev`.

**Write that hostname down** — step 4 needs it. The site will work; the
feedback form won't submit yet. That's expected.

If you want a custom domain, attach it now rather than later, so the Turnstile
widget can be created with both hostnames in one pass: Cloudflare dashboard →
**Workers & Pages** → `activity-visualizer` → **Settings** → **Domains &
Routes** → **Add**.

---

## 4. Cloudflare: create the Turnstile widget

Dashboard → **Turnstile** in the left-hand nav → **Add widget**.

| Field | Value |
| --- | --- |
| Widget name | anything, e.g. `activity-visualizer feedback` |
| Hostnames | your `*.workers.dev` hostname from step 3, **plus** any custom domain |
| Widget mode | **Managed** |

You get a **Site Key** (public) and a **Secret Key** (not public). Keep the tab
open for step 5.

Don't add `localhost` here — local development keeps using Cloudflare's test
key pair, which is already wired into `.env` and `.dev.vars.example`.

---

## 5. Wire in the three values

**Site key → `.env`** (committed; a site key is public by design — it ships in
the page HTML):

```
VITE_TURNSTILE_SITE_KEY=<the Site Key from step 4>
```

**The two secrets → Wrangler** (never committed; these are prompted for
interactively and stored encrypted at Cloudflare):

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY   # paste the Secret Key from step 4
npx wrangler secret put GITHUB_TOKEN           # paste the PAT from step 1b
```

Confirm both registered:

```bash
npx wrangler secret list
```

---

## 6. Redeploy — the step that actually activates the form

```bash
npm run deploy
```

Without this, the deployed bundle still carries the test site key. This is the
trap from the top of the page.

---

## 7. Verify in the browser

Open the deployed URL and click **Feedback** in the footer.

- [ ] The dialog opens, centred, with a dimmed backdrop.
- [ ] The "this opens a public issue on GitHub" notice is visible.
- [ ] A Turnstile widget renders and resolves. **Send feedback** is disabled
      until it does.
- [ ] Submit a real message → "Thanks — your feedback was filed as issue #N"
      with a working link.
- [ ] That issue exists on `Mcklmo/timeseries-visualizer`, is labelled
      `feedback`, and its body has your message plus page URL / timestamp /
      user agent.
- [ ] Submit with the fields empty → **inline errors under each field**, not a
      banner.
- [ ] Submit ~6 times inside a minute → the "too many submissions" banner.
- [ ] Press `Esc` with the dialog open → it closes. *(This one is only ever
      checked here — jsdom can't simulate it, so no automated test covers it.)*
- [ ] Re-open the dialog → fields are empty, not your previous attempt.
- [ ] Narrow the window to phone width → the dialog still fits and the form is
      usable.

If something fails, `npx wrangler tail` streams the live Worker logs; the route
logs the real reason for every 502 and 500 while telling the browser only a
generic message.

Then close the loop: delete the test issues you filed, and delete `TODO.md`
(its own last line says so).

---

## Optional: prove it end-to-end locally first

If you'd rather not test against the live site, `wrangler dev` runs the real
Worker locally. It will file **real** issues on the repo — that's the point,
but be aware.

```bash
cp .dev.vars.example .dev.vars   # already exists if I ran the smoke test
```

Put your real PAT in `.dev.vars` as `GITHUB_TOKEN` (leave `TURNSTILE_SECRET_KEY`
as the test secret — it pairs with the test site key already in `.env`), then:

```bash
npm run build && npx wrangler dev
```

Open `http://localhost:8787`. `npm run dev` will **not** work for this —
`/api/feedback` only exists inside the Worker.

`.dev.vars` is gitignored. Confirm with `git status` before committing anything.

---

## Three judgement calls I left to you

**1. The About page's privacy copy — settled 2026-08-07, no longer open.** It
was resolved together with the intervals.icu feature, which introduced a second
exception of exactly this shape. `AboutPage.jsx` keeps the original claim
verbatim (it is still true, and three tests pin the phrase) and follows it with
a paragraph naming both exceptions: the feedback form posts what you write to
GitHub as a public issue, and the intervals.icu connection is off unless you
turn it on, at which point the browser talks to intervals.icu directly with
nothing passing through this app's server. See ARCHITECTURE.md §0.

**2. `@mentions` in submitted messages.** The issue body renders the reporter's
message as plain markdown, so `@someone` becomes a real GitHub ping. On a
personal repo that's a nuisance at worst, and neutralising it would make
legitimate formatting worse — but it is a way to make your issue tracker
notify strangers. Worth knowing before it happens.

**3. `npm run lint` has one pre-existing failure** in
`src/stats/useMetricStats.js` (`react-hooks/exhaustive-deps` rule not found —
an ESLint plugin/config version problem). It predates this work. Also note
ESLint is configured for `**/*.{ts,tsx}` only, so *none* of this project's
`.js`/`.jsx` — including everything in `worker/` — is linted at all. Widening
that config is its own small task.
