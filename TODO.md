# Feedback → GitHub Issue feature — progress

Implementing the plan at `~/.claude/plans/i-m-planning-to-add-expressive-beaver.md`
(footer "Feedback" link → `<dialog>` popup → `POST /api/feedback` → labelled
GitHub issue on `Mcklmo/timeseries-visualizer`, guarded by Cloudflare Turnstile
+ a native Rate Limiting binding).

**Read the plan file first — it holds the confirmed decisions, the full
request/response contract table, and the rationale for each choice. This file
only tracks what is actually on disk.**

**Status: backend + client transport done and green. Frontend components,
wiring, styles, config and docs outstanding.**

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
      comment in the file). No test file yet; covered via `FeedbackForm.test.jsx`.
- [x] `npx vitest run worker` — 6 files / 41 tests green

## Outstanding

- [ ] `src/ui/FeedbackDialog.jsx` (+ test) — always-mounted `<dialog>` (stable
      ref for `showModal()`), renders `<FeedbackForm>` only while open so
      re-opening starts fresh; `close` listener attached manually via
      `addEventListener`, not a JSX prop (React's synthetic handling of
      `<dialog>`'s native `close`/`cancel` is inconsistent)
- [ ] `src/ui/FeedbackForm.jsx` (+ test) — subject/message/email + Turnstile
      mount point + submit/validation/result states. Use `maxLength` from
      `FEEDBACK_LIMITS` for UX only; **no** `required`/`minLength` (native
      constraint validation would block submit before the handler runs, and the
      422 path is what the tests drive). Copy must say the issue — including
      any email given — is public. On any failure call `resetToken()`
      (Turnstile tokens are single-use).
- [ ] `src/ui/FeedbackWidget.jsx` (+ test) — footer trigger button, owns
      `isOpen`
- [ ] `src/App.jsx` — persistent `<footer className="app-footer">` inside
      `.app`, outside the `status` switch (mirrors the header); plus an
      `App.test.jsx` assertion that the trigger persists across statuses
- [ ] `src/setupTests.js` — `<dialog>` stub (jsdom 30 has no
      `showModal`/`close`). `close()` should no-op when not `[open]`, else
      remove the attribute and dispatch a `close` event.
- [ ] `src/styles/tokens.css` — add `--danger: #ef476f;` `--success: #06d6a0;`
- [ ] `src/styles/global.css` — `.app-footer`, `.feedback-trigger`,
      `.feedback-dialog` + `::backdrop`, `.feedback-form`,
      `.feedback-form__error`, `.feedback-form__success` (flat
      class-per-component convention, as in the rest of the file)
- [ ] `wrangler.jsonc` — add `main: "worker/index.js"`,
      `assets.binding: "ASSETS"`, `vars` (`GITHUB_REPO_OWNER`/`GITHUB_REPO_NAME`),
      `ratelimits` (`FEEDBACK_RATE_LIMITER`, `namespace_id` "1001",
      `simple: {limit: 5, period: 60}`)
- [ ] `.gitignore` — add `!.dev.vars.example` negation under the existing
      `.dev.vars*`
- [ ] `.dev.vars.example` (committed) and `.env` (committed — the Turnstile
      *site* key is public). Real `.dev.vars` stays untracked.
- [ ] `package.json` — pin `wrangler` devDependency, add
      `"deploy": "npm run build && wrangler deploy"`
- [ ] `doc/ARCHITECTURE.md` — §0 progress bullet, §4 scaffold gains `worker/`
      and `shared/`, plus the dependency rule: `shared/` is plain
      environment-agnostic values; `worker/` and `src/` may each import from
      `shared/`, never from each other
- [ ] `README.md` — **required.** Replace "Deploying (Cloudflare Pages)" with
      "Deploying (Cloudflare Workers)" (`npm run build`, two
      `wrangler secret put`s, `wrangler deploy`). The old dashboard flow cannot
      serve `/api/feedback` at all, so leaving it is actively wrong.
- [ ] `npm test` (full suite) + `npm run build`
- [ ] `npx wrangler dev` smoke test — submit with the local test sitekey/secret,
      confirm a real issue appears, then check the 422 and 429 UI copy

## Manual/external setup — for the repo owner, not the agent

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
