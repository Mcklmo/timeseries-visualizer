# Feedback → GitHub Issue feature — progress

Implementing the plan at `~/.claude/plans/i-m-planning-to-add-expressive-beaver.md`
(footer "Feedback" link → `<dialog>` popup → `POST /api/feedback` → labelled
GitHub issue on `Mcklmo/timeseries-visualizer`, guarded by Cloudflare Turnstile
+ a native Rate Limiting binding).

**Read the plan file first — it holds the confirmed decisions, the full
request/response contract table, and the rationale for each choice. This file
only tracks what is actually on disk.**

**Status: implementation, automated tests and the `wrangler dev` API smoke
test all done. Only the manual in-browser checks and the owner-only external
setup are outstanding.**

## Done

- [x] `shared/feedbackLimits.js` — values-only module imported by both sides
      (subject 3–120, message 10–4000, email ≤254)
- [x] `worker/lib/httpResponses.js` — `jsonResponse` / `errorResponse`
- [x] `worker/lib/validateFeedback.js` (+ test) — server-authoritative
      trimming/length/email checks against the shared limits
- [x] `worker/lib/buildIssuePayload.js` (+ test) — pure; message first, then a
      metadata bullet list (page/timestamp/UA, email only when supplied);
      strips backticks+newlines from metadata so a crafted value can't break
      out of its code span; labels `['feedback']`
- [x] `worker/lib/verifyTurnstile.js` (+ test) — injectable `fetchImpl`, fails
      closed on outage/malformed/non-2xx
- [x] `worker/lib/githubClient.js` (+ test) — injectable `fetchImpl`, never
      returns GitHub's error body or the token to the caller
- [x] `worker/lib/rateLimit.js` (+ test) — thin wrapper over
      `env.FEEDBACK_RATE_LIMITER.limit()`; **fails open** if the binding is
      absent (local dev), by design
- [x] `worker/routes/feedback.js` (+ test) — orchestration in order: method →
      body-size (20 KB) → JSON parse → validate → rate limit → Turnstile →
      GitHub. Route test stubs `globalThis.fetch` routed by URL and exercises
      the real chain (201/400/405/422/429/403/502/500)
- [x] `worker/index.js` — `fetch(request, env)`: `/api/feedback` → route,
      everything else → `env.ASSETS.fetch(request)` (Workers-with-static-assets
      model; Pages' `functions/` convention does **not** apply)
- [x] `src/lib/feedbackClient.js` (+ test) — `submitFeedback(submission,
      fetchImpl = fetch)`; returns a discriminated result instead of throwing
      (the UI must tell 422 field errors from network/rate-limit/upstream)
- [x] `src/ui/useTurnstile.js` — lazy singleton script load + explicit
      `render`/`remove`/`reset`; exports `TURNSTILE_SITE_KEY` from
      `import.meta.env.VITE_TURNSTILE_SITE_KEY`, falling back to Cloudflare's
      test sitekey (fails *closed* against a real prod secret — see the
      comment in the file). No test file of its own; covered through
      `FeedbackForm.test.jsx`, which stubs `window.turnstile`.
- [x] `src/ui/FeedbackForm.jsx` (+ test) — fields, Turnstile mount point,
      submit/validation/result states. `maxLength` from `FEEDBACK_LIMITS`,
      deliberately **no** `required`/`minLength` (native validation would
      intercept submit before the 422 round-trip). Copy states the issue and
      any email given are public. `resetToken()` on every failure.
- [x] `src/ui/FeedbackDialog.jsx` (+ test) — always-mounted `<dialog>`, form
      rendered only while open, `close` listener attached via
      `addEventListener` (not a JSX prop)
- [x] `src/ui/FeedbackWidget.jsx` (+ test) — footer trigger, owns `isOpen`
- [x] `src/setupTests.js` — `<dialog>` `showModal`/`close` stub
- [x] `src/App.jsx` — persistent `<footer className="app-footer">` inside
      `.app`, outside the `status` switch; `App.test.jsx` asserts the trigger
      survives idle → loading → error → ready.
      **Gotcha found:** "Feedback" contains "back", so the pre-existing
      `getByRole('button', {name: /back/i})` in the About test started matching
      two buttons — it is now anchored to `/^←\s*back$/i`.
- [x] `npx vitest run worker` — 6 files / 41 tests green
- [x] `npx vitest run src/lib src/ui/Feedback src/App.test.jsx` — green

- [x] `src/styles/tokens.css` — `--danger` / `--success` semantic tokens
- [x] `src/styles/global.css` — `.app-footer`, `.feedback-trigger`,
      `.feedback-dialog` + `::backdrop`, `.feedback-form` and its
      `__notice`/`__hint`/`__error`/`__success`/`__captcha` parts
- [x] `wrangler.jsonc` — `main`, `assets.binding`, `vars`, `ratelimits`
- [x] `.gitignore` — `!.dev.vars.example` negation
- [x] `.dev.vars.example` + `.env` (both committed; the Turnstile *site* key is
      public by design, the secret half never is)
- [x] `package.json` — `wrangler@^4.120.0` devDependency + `npm run deploy`
- [x] `doc/ARCHITECTURE.md` — §0 progress bullet, §4 scaffold with `worker/`
      and `shared/`, and the new cross-boundary dependency rule
- [x] `README.md` — "Deploying (Cloudflare Pages)" replaced with "Deploying
      (Cloudflare Workers)" + a "Feedback form configuration" table; status,
      project structure, testing notes and the `wrangler dev` section updated;
      manual walkthrough steps 11–12 added
- [x] `npm test` — 40 files / 307 tests green
- [x] `npm run build` — clean; confirmed the sitekey is inlined into the bundle
- [x] `npx wrangler dev` API smoke test against the real Workers runtime — all
      bindings resolved (rate limiter, ASSETS, both vars, both secrets), and:
      `GET` → 405 · malformed body → 400 · empty fields → 422 with the per-field
      map · valid submission → **502**, which is the correct end of the chain
      here: Turnstile passed (test secret always does) and GitHub rejected the
      *placeholder* PAT in `.dev.vars` · 6th request in a minute → 429 with
      `Retry-After: 60` · `/` → 200 from `env.ASSETS`

## Outstanding

- [ ] **Manual browser walkthrough** (README steps 11–12) — needs
      `wrangler dev`, not `npm run dev`, since `/api/feedback` only exists in
      the Worker. Requires a real `GITHUB_TOKEN` in `.dev.vars` first; the
      placeholder there gets a 502 by design. No issue has been filed on the
      repo yet — the end-to-end "a real issue actually appears" check is still
      unproven.
- [ ] Escape-key dialog dismissal — real browser behaviour jsdom won't
      simulate; check by hand, don't chase it with more stubs.

## Known non-blocking notes

- `npm run lint` reports one **pre-existing** error in
  `src/stats/useMetricStats.js` (`react-hooks/exhaustive-deps` rule not found —
  a plugin/config version issue), unrelated to this feature and present before
  it. ESLint is configured for `**/*.{ts,tsx}` only, so none of the new
  `.js`/`.jsx` files are linted at all.
- ~~`src/ui/AboutPage.jsx` says the app "runs entirely in your browser… nothing
  is recorded, collected, or sold"…~~ **Resolved 2026-08-07**, alongside the
  intervals.icu feature, which added a second exception of the same shape. The
  scoped, still-true claim is kept **verbatim** — three assertions across
  `AboutPage.test.jsx` and `App.test.jsx` pin the phrase `/runs entirely in your
  browser/i`, so keeping it made the rewrite cost zero test churn — and a second
  paragraph now names both exceptions: the feedback form posts what you write to
  GitHub as a public issue, and the intervals.icu connection is off unless you
  turn it on, at which point your browser talks to intervals.icu directly with
  nothing passing through this app's server. Same adjustment made in
  `EmptyState.jsx` (as a sibling line on the new CTA, leaving the file-path
  claim untouched), `README.md` and `doc/overview.md`.
- The issue body renders the reporter's message as plain markdown, so an
  `@mention` in it would ping that GitHub user. Low stakes for a personal repo,
  and not in the plan — flagged rather than silently transformed.

## Manual/external setup — for the repo owner, not the agent

**→ Full ordered walkthrough: [doc/FEEDBACK_SETUP.md](doc/FEEDBACK_SETUP.md).**
The summary below is just the shape of it.

1. Create a **Turnstile widget** in the Cloudflare dashboard for the site's
   domain; put its public sitekey in `.env` as `VITE_TURNSTILE_SITE_KEY`.
   Until then the committed value is Cloudflare's always-passes test key.
2. Create a **fine-grained GitHub PAT** scoped to `Mcklmo/timeseries-visualizer`
   only, with "Issues: write".
3. `npx wrangler secret put GITHUB_TOKEN` and
   `npx wrangler secret put TURNSTILE_SECRET_KEY` (one-time, prod).
4. Copy `.dev.vars.example` → `.dev.vars` for local `wrangler dev`.
5. Escape-key dialog dismissal is real browser behaviour jsdom does not
   simulate — check it by hand, don't chase it with more stubs.

Delete this file once the feature has shipped and the manual checks are done.
