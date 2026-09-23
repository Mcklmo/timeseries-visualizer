// The sending half of the share-link feature (issue #4): one button that
// turns the activity on screen into a URL and hands it to the person.
//
// **It encodes the IN-MEMORY Activity, never the original file.** That is
// what makes it work identically for a dropped FIT, an intervals.icu sync and
// a Strava stream — three sources, one codec — and it is why this component
// needs no ActivitySource and no ref: the activity itself is the input.
//
// The URL it shares, in order of preference:
//   1. `origin/s/<id>` — POST /api/share stores the payload, ~45 chars,
//      survives every messaging app.
//   2. `origin/#a=<payload>` — the serverless fallback when that POST fails
//      (offline, dev server without the Worker). Multi-KB but fully
//      self-contained; shareClient.js explains why the fallback is silent.
//
// Delivery: `navigator.share` where it exists (the share sheet is the native
// verb on the phone this feature was requested from), else clipboard + a
// transient "Copied". An AbortError from the sheet is the person changing
// their mind, not a failure — same philosophy as the OAuth hook's
// `access_denied`. Any OTHER share-sheet refusal (e.g. transient activation
// expiring behind a slow network) falls through to the clipboard rather than
// erroring: the URL is in hand, so hand it over somehow.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SHARE_HASH_PREFIX, encodeActivityToPayload } from '../data/shared/shareCodec.js'
import { createShortShareLink } from '../lib/shareClient.js'
import { markUsed } from '../lib/usage.js'
import { useActivity } from '../state/ActivityContext.jsx'

const COPIED_RESET_MS = 2000

export function ShareActivityButton() {
  const { activity } = useActivity()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const copiedTimer = useRef(null)

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const onShare = useCallback(async () => {
    setBusy(true)
    setError(null)
    setCopied(false)
    markUsed('share')
    try {
      const payload = await encodeActivityToPayload(activity)
      const short = await createShortShareLink(payload)
      const url = short.ok
        ? `${location.origin}/s/${short.id}`
        : `${location.origin}/${SHARE_HASH_PREFIX}${payload}`

      if (navigator.share) {
        try {
          await navigator.share({ url })
          return
        } catch (shareError) {
          if (shareError?.name === 'AbortError') return
          // Fall through to the clipboard — see the module header.
        }
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error('Sharing is not available in this browser')
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
    } catch (caught) {
      // Inline beside the button, ExportWindowButton's pattern: the activity
      // on screen is still perfectly good.
      setError(caught instanceof Error ? caught.message : 'Sharing failed')
    } finally {
      setBusy(false)
    }
  }, [activity])

  // CompressionStream gates the whole feature (Safari < 16.4): a button that
  // appears and then errors is worse than one that never appears.
  if (!activity || typeof CompressionStream === 'undefined') return null

  return (
    <>
      <button
        type="button"
        className="share-activity"
        onClick={onShare}
        disabled={busy}
        title="Share a link that opens this activity"
      >
        {busy ? 'Sharing…' : copied ? 'Copied' : 'Share'}
      </button>
      {error && (
        <span className="share-activity__error" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
