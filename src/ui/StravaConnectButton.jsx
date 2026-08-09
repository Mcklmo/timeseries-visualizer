// The "Connect with Strava" control, and the disclosure that has to sit with
// it. Nothing here fetches: `beginAuthorization` mints the CSRF state, stores
// it in sessionStorage and returns a URL; the caller navigates. Keeping
// navigation out of the module is what makes the flow testable without a jsdom
// navigation stub, and it is why `onNavigate` is a prop with a real default.
//
// ---
// **⚠ BRAND ASSET OUTSTANDING — this must be resolved before launch.**
//
// Strava's API Agreement requires their **own** "Connect with Strava" button
// artwork, downloaded from their brand guidelines
// (https://developers.strava.com/guidelines/), not a recreation of it. That
// file is not in this repo yet, and drawing a lookalike would be worse than
// this: a near-copy of a trademark is a trademark problem, where a plainly
// unbranded stand-in is only an unfinished one.
//
// So this renders an explicitly *unbranded* button in Strava's orange, and the
// swap is deliberately one line: drop the official SVG into
// `public/strava/btn_strava_connect_with_orange.svg` and replace the <span>
// below with an <img>. `StravaConnectButton.test.jsx` pins the attribution and
// the scope disclosure, which are separate obligations that stay either way.
//
// The **"Powered by Strava" attribution** below the button is a second, always
// required obligation and is already correct.
// ---
//
// **The scope is disclosed on the button, not buried.** `activity:read_all`
// includes private activities, and asking for it silently would be the wrong
// trade even though the narrower scope produces a worse failure ("my run isn't
// in the list"). Saying which one and why is what makes it a choice.
import { beginAuthorization } from '../data/strava/stravaAuth.js'

/**
 * The **public** half of the Strava app's credentials — it ships in the
 * authorize URL every athlete is redirected to, exactly like the Turnstile
 * *site* key. The secret half is a Worker secret and never reaches this bundle.
 *
 * Vite inlines this at build time, so changing `.env` does nothing until the
 * next build — unlike the Worker's secrets, which are read at runtime.
 */
export const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || ''

/**
 * The value committed in `.env` until the real apps are registered. Recognised
 * rather than trusted: sending an athlete to Strava with this in the URL lands
 * them on Strava's own "invalid client_id" page, which reads as *their* account
 * being broken. Failing here, visibly and locally, is strictly better.
 */
const PLACEHOLDER_CLIENT_ID = 'REPLACE_WITH_PRODUCTION_STRAVA_CLIENT_ID'

/** True when this build cannot start an OAuth flow at all. */
export function isClientIdConfigured(clientId = STRAVA_CLIENT_ID) {
  return Boolean(clientId) && clientId !== PLACEHOLDER_CLIENT_ID
}

/**
 * @param {{
 *   clientId?: string,
 *   onNavigate?: (url: string) => void,
 *   beginAuthorizationImpl?: typeof beginAuthorization,
 * }} props
 */
export function StravaConnectButton({
  clientId = STRAVA_CLIENT_ID,
  onNavigate = (url) => globalThis.location.assign(url),
  beginAuthorizationImpl = beginAuthorization,
}) {
  if (!isClientIdConfigured(clientId)) {
    // A developer-facing failure, in the UI rather than the console, because
    // the console is where it would be missed. Deliberately not styled as an
    // error state the athlete has to act on — they cannot.
    return (
      <p className="strava-connect__unconfigured" role="alert">
        Strava isn&apos;t configured in this build. <code>VITE_STRAVA_CLIENT_ID</code> is unset or
        still the placeholder — see &ldquo;Connecting Strava&rdquo; in the README.
      </p>
    )
  }

  return (
    <div className="strava-connect">
      <button
        type="button"
        className="strava-connect__button"
        onClick={() => onNavigate(beginAuthorizationImpl({ clientId }))}
      >
        {/* Replace with Strava's official artwork — see the header. */}
        <span className="strava-connect__wordmark">Connect with Strava</span>
      </button>

      <p className="strava-connect__disclosure">
        Opens Strava&apos;s own sign-in page. This app asks for{' '}
        <strong>read-only access to your activities, including private ones</strong> — it can never
        change or post anything. Leave the private-activity permission ticked, or activities you
        marked private simply won&apos;t appear here.
      </p>

      {/* Required attribution, and it is not the same obligation as the button
          artwork — this one stays whatever the button ends up looking like. */}
      <p className="strava-connect__attribution">Powered by Strava</p>
    </div>
  )
}
