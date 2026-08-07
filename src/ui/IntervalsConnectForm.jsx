// The disconnected half of IntervalsPage: paste a key, prove it works, and
// only then hand it up to be stored.
//
// The key is validated against /athlete/0/profile *before* IntervalsPage
// saves it, so a typo never gets persisted and there is no "connected but
// permanently broken" state to recover from. On success this component
// unmounts, which is also why the key isn't left sitting in a live DOM input.
//
// The copy is deliberately blunt about what the key is. It is a password, not
// a session token: unscoped, no expiry, and revocable only by regenerating it
// in intervals.icu's settings. See credentialStore.js for the full trade.
import { useState } from 'react'
import { INTERVALS_SETTINGS_URL, IntervalsApiError, fetchProfile } from '../data/intervals/intervalsApi.js'

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

/**
 * @param {{onConnected: (apiKey: string) => void, fetchImpl?: typeof fetch, notice?: string}} props
 */
export function IntervalsConnectForm({ onConnected, fetchImpl, notice }) {
  const [apiKey, setApiKey] = useState('')
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setError('Paste your API key first.')
      return
    }

    setIsChecking(true)
    setError(null)
    try {
      await fetchProfile({ apiKey: trimmed, fetchImpl })
      onConnected(trimmed)
    } catch (caught) {
      setError(caught instanceof IntervalsApiError ? caught.message : FALLBACK_ERROR)
      setIsChecking(false)
    }
  }

  return (
    <form className="intervals-connect" onSubmit={handleSubmit} noValidate>
      <p className="intervals-connect__lead">
        Load activities straight from your intervals.icu account — useful on a phone, where the
        original file from your watch isn&apos;t something you can browse to.
      </p>

      {notice && (
        <p className="intervals-connect__error" role="alert">
          {notice}
        </p>
      )}

      <label htmlFor="intervals-api-key">intervals.icu API key</label>
      <input
        id="intervals-api-key"
        name="apiKey"
        type="password"
        autoComplete="off"
        spellCheck="false"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'intervals-api-key-error' : undefined}
      />
      <p className="intervals-connect__hint">
        In intervals.icu, open{' '}
        <a href={INTERVALS_SETTINGS_URL} target="_blank" rel="noreferrer noopener">
          Settings
        </a>{' '}
        and scroll to the bottom, to <strong>Developer Settings</strong>.
      </p>

      {error && (
        <p className="intervals-connect__error" id="intervals-api-key-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={isChecking}>
        {isChecking ? 'Checking…' : 'Connect'}
      </button>

      <p className="intervals-connect__notice">
        Your browser talks to intervals.icu directly — the key and your activities never pass
        through this app&apos;s server. The key is kept in this browser&apos;s local storage until
        you disconnect. Treat it as a password: it grants full read <em>and write</em> access to
        your whole intervals.icu account, and the only way to revoke it is to regenerate it in
        Developer Settings.
      </p>
    </form>
  )
}
