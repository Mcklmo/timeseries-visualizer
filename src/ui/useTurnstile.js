// Cloudflare Turnstile widget lifecycle for the feedback dialog.
//
// Two deliberate choices:
// 1. Lazy load. The script is injected on first use, not from index.html —
//    most visitors never open the feedback dialog and shouldn't pay for it.
//    A module-level singleton promise makes repeated opens cheap and safe.
// 2. Explicit render (`turnstile.render(el, ...)`) rather than the implicit
//    `data-sitekey` div, because only the explicit API gives back a widget id,
//    which is what `remove()` (no leaked hidden iframes across repeated opens)
//    and `reset()` (Turnstile tokens are single-use, so a failed submit needs
//    a fresh one) both require.
import { useCallback, useEffect, useRef, useState } from 'react'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// Cloudflare's published "always passes" test sitekey. Only a fallback: the
// real public sitekey comes from .env (VITE_TURNSTILE_SITE_KEY). Note this
// fails *closed* rather than silently weakening production — a token minted by
// the test sitekey does not verify against a real TURNSTILE_SECRET_KEY, so a
// deploy that forgot the env var gets rejected submissions, not unguarded ones.
const TEST_SITE_KEY = '1x00000000000000000000AA'

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || TEST_SITE_KEY

let scriptPromise = null

function loadTurnstileScript() {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      script.addEventListener('load', () => resolve())
      script.addEventListener('error', () => {
        // Clear the singleton so a later open can retry rather than being stuck
        // with one permanently rejected promise.
        scriptPromise = null
        reject(new Error('Turnstile failed to load'))
      })
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

/**
 * Renders one widget into `containerRef` for as long as the calling component
 * is mounted. FeedbackDialog only mounts FeedbackForm while open, so mounting
 * *is* the lifecycle — there is no separate enable/disable flag.
 *
 * @returns {{containerRef: import('react').RefObject<HTMLDivElement>, token: string|null,
 *            status: 'loading'|'ready'|'unavailable', resetToken: () => void}}
 */
export function useTurnstile() {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [token, setToken] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: (nextToken) => setToken(nextToken),
          // Both are recoverable: dropping the token just re-disables submit
          // until the widget hands back a fresh one.
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        })
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current != null) {
        window.turnstile?.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [])

  const resetToken = useCallback(() => {
    setToken(null)
    if (widgetIdRef.current != null) window.turnstile?.reset(widgetIdRef.current)
  }, [])

  return { containerRef, token, status, resetToken }
}
