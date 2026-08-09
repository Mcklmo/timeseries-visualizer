// The "Connect with Strava" control, and the disclosure that has to sit with
// it. Nothing here fetches: `beginAuthorization` mints the CSRF state, stores
// it in sessionStorage and returns a URL; the caller navigates. Keeping
// navigation out of the module is what makes the flow testable without a jsdom
// navigation stub, and it is why `onNavigate` is a prop with a real default.
//
// ---
// **The artwork is Strava's own file, unmodified.** Their API Agreement
// requires *their* asset, downloaded from the brand guidelines
// (https://developers.strava.com/guidelines/) — a recreation, however close,
// would be a trademark problem. `public/strava/btn_strava_connect_with_orange.svg`
// is the "1.1 Connect with Strava Buttons" orange SVG byte-for-byte, served as
// a static file rather than inlined so it stays visibly *theirs* and a future
// re-download is a file copy, not a diff to read.
//
// It is an <img>, not an inline <svg>, for the same reason: nothing in this
// app's CSS can reach inside it and recolour it. The wrapping <button> carries
// no background, border or padding — the artwork already contains all three,
// and the sizing lives in one `.strava-connect__artwork` rule that only ever
// scales it proportionally. Do not restyle it.
//
// The **"Powered by Strava" attribution** below the button is a second,
// separate and always-required obligation, and it stays regardless.
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
        {/* Strava's file, unaltered. The alt text is what gives the button its
            accessible name — the artwork's wordmark is paths, not text. */}
        <img
          className="strava-connect__artwork"
          src="/strava/btn_strava_connect_with_orange.svg"
          alt="Connect with Strava"
          width="237"
          height="48"
        />
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
