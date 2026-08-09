// The other half of Strava's OAuth flow: what happens when the athlete lands
// back on `/?state&code&scope`. Mounted **once**, in AppShell, because a
// callback is a property of the page load rather than of any view — the athlete
// left from the Strava page, but they come back to whatever `/` renders.
//
// `redirect_uri` is `${origin}/` (see data/strava/stravaAuth.js): Strava pins
// only the domain, `/` is already served, and there is no router in this app to
// give a callback path to.
//
// ---
//
// **THE TRAP THIS MODULE EXISTS TO SURVIVE.** The OAuth `code` is single-use,
// and `main.jsx` wraps the tree in `<StrictMode>`, which deliberately invokes
// every effect twice in development. So the naive version exchanges the code,
// then exchanges it again, and the second attempt fails with a 400 that names
// nothing useful — in development only, on a path that works perfectly in
// production, which is the worst possible shape for a bug.
//
// **Two guards, and both are needed:**
//
//   1. A `useRef(false)` flipped **synchronously, before the first `await`**.
//      Flipping it after the exchange resolves does nothing at all: the second
//      invocation runs long before the first promise settles. This is the guard
//      against StrictMode's double-invoke.
//   2. `history.replaceState` stripping the query **in that same synchronous
//      block**. This is the guard against everything else — a genuine remount, a
//      reload, the back button — because a remount gets a fresh ref, and the
//      only durable defence is that there is no `code` in the URL any more.
//
// Neither subsumes the other. The ref survives a URL that hasn't been rewritten
// yet; the URL survives a component that has been torn down and rebuilt.
//
// ---
//
// **`consumeStoredState` is read-and-delete, single use** (see stravaAuth.js).
// A mismatch or an absent state refuses **without exchanging** — the exchange
// is the irreversible step, so the CSRF check has to come first, not alongside.
// A callback landing in a different tab correctly fails, because the state was
// minted into that other tab's sessionStorage.
//
// **`access_denied` is a user choice, not an error state**, and it gets its own
// copy. Someone who pressed Cancel does not need an alert telling them
// something went wrong.
import { useEffect, useRef, useState } from 'react'
import { StravaApiError, exchangeCode } from '../data/strava/stravaApi.js'
import {
  consumeStoredState,
  hasRequiredScope,
  readCallbackParams,
} from '../data/strava/stravaAuth.js'
import { stravaTokenStore } from '../data/strava/stravaTokenStore.js'

/** Every refusal this hook can produce, in the athlete's words. Each one is a
 *  different thing that happened, and saying "something went wrong" to all four
 *  would make three of them unactionable. */
export const CALLBACK_MESSAGES = {
  denied: 'Strava access was not granted. Nothing was connected, and you can try again whenever you like.',
  state:
    "That Strava sign-in couldn't be verified — it may have finished in a different tab, or taken too long. Please connect again.",
  scope:
    'Strava was connected without permission to see your activities. Connect again and leave the activity permissions ticked.',
}

/**
 * Returns a **status**, and deliberately takes no `onConnected` callback. Every
 * caller would pass an inline arrow, which would either re-run this effect on
 * every render or need a ref to defend against it — and an effect that re-runs
 * is exactly what the two guards above exist to survive, so leaning on them to
 * cover a dependency mistake would hide the real bug until one was removed. A
 * status the caller reacts to has neither problem.
 *
 * `'refused'` is a settled outcome like `'connected'`, not an error: the caller
 * routes both to the Strava view, because a refusal has something to say and
 * the connect screen is where saying it makes sense.
 *
 * @param {{store?: typeof stravaTokenStore, fetchImpl?: typeof fetch}} [options]
 * @returns {{status: 'idle'|'exchanging'|'connected'|'refused', message: string|null}}
 */
export function useStravaOAuthCallback({ store = stravaTokenStore, fetchImpl } = {}) {
  const [status, setStatus] = useState(/** @type {'idle'|'exchanging'|'connected'|'refused'} */ ('idle'))
  const [message, setMessage] = useState(/** @type {string|null} */ (null))
  // Guard 1. See the header — this must be flipped before the first await, not
  // after the exchange resolves.
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    const params = readCallbackParams()
    // Overwhelmingly the common case: an ordinary page load, not a callback.
    // Nothing is read, nothing is written, and no state changes — a visitor who
    // never touches Strava must not pay for this hook being mounted.
    if (!params) return

    // ---- the synchronous block. Nothing may await above this line. ----
    handled.current = true
    stripCallbackQuery()

    if (params.error || !params.code) {
      // `access_denied` is Strava's spelling for "the athlete pressed Cancel".
      setStatus('refused')
      setMessage(CALLBACK_MESSAGES.denied)
      return
    }

    // Read-and-delete, and *before* the exchange: the exchange is the
    // irreversible step, so a state that doesn't match must stop the flow
    // rather than merely annotate it.
    const expected = consumeStoredState()
    if (!expected || expected !== params.state) {
      setStatus('refused')
      setMessage(CALLBACK_MESSAGES.state)
      return
    }

    // Strava lets the athlete untick "View data about your private activities"
    // on the consent screen. Checked here rather than discovered later as a
    // mysteriously short list.
    if (!hasRequiredScope(params.scope)) {
      setStatus('refused')
      setMessage(CALLBACK_MESSAGES.scope)
      return
    }
    // ---- end of the synchronous block ----

    setStatus('exchanging')

    // **No `cancelled` flag, and no cleanup — deliberately, against the
    // pattern every other effect in this repo follows.** Those guard against a
    // *stale* response landing after a *newer* run started, which is a real
    // hazard when an effect re-fires on changing deps. Here `handled` has
    // already made this body single-shot for the life of the page: there is no
    // newer run, so a cleanup that set `cancelled` could only ever abort the
    // one exchange there will ever be.
    //
    // That is not hypothetical — it is exactly what StrictMode produces. It
    // mounts, unmounts and remounts, so the cleanup fires, the second
    // invocation returns early on `handled`, and the in-flight promise resolves
    // into a discarded closure. The athlete's tokens are saved and the status
    // never leaves 'exchanging', so the app sits on a spinner having *actually
    // connected*. StravaPage.test and the StrictMode case in this hook's suite
    // both pin it.
    //
    // Setting state after an unmount is a no-op in React 18+, not a warning,
    // and AppShell — the only mount point — lives as long as the page does.
    exchangeCode({ code: params.code, fetchImpl })
      .then((tokens) => {
        store.save({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          athleteId: tokens.athlete?.id ?? null,
        })
        setStatus('connected')
        setMessage(null)
      })
      .catch((caught) => {
        setStatus('refused')
        // StravaApiError already carries copy written for this athlete; only a
        // genuinely unexpected throw needs a fallback.
        setMessage(caught instanceof StravaApiError ? caught.message : CALLBACK_MESSAGES.state)
      })
  }, [store, fetchImpl])

  return { status, message }
}

/**
 * Guard 2. Rewrites the address bar to the bare path, so a reload, a remount or
 * the back button finds no `code` to re-exchange.
 *
 * `replaceState`, not `pushState`: the callback URL must not become a history
 * entry the athlete can navigate back onto. The hash is preserved for the same
 * reason the path is — this app puts nothing there today, but silently
 * discarding part of the URL is the kind of thing that is discovered much later.
 */
function stripCallbackQuery() {
  try {
    const { pathname, hash } = globalThis.location ?? {}
    globalThis.history?.replaceState?.(null, '', `${pathname ?? '/'}${hash ?? ''}`)
  } catch {
    // Some embedded contexts refuse replaceState. The ref guard still holds for
    // this page life, which is the case that actually matters.
  }
}
