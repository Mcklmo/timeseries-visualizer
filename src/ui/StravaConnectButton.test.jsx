import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REQUIRED_SCOPE, STRAVA_STATE_STORAGE_KEY } from '../data/strava/stravaAuth.js'
import { StravaConnectButton, isClientIdConfigured, STRAVA_CLIENT_ID } from './StravaConnectButton.jsx'

beforeEach(() => {
  globalThis.sessionStorage.clear()
})

describe('StravaConnectButton', () => {
  it('builds an authorize URL carrying the client id, redirect, scope and a fresh state', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<StravaConnectButton clientId="test-client-id" onNavigate={onNavigate} />)

    await user.click(screen.getByRole('button', { name: /connect with strava/i }))

    expect(onNavigate).toHaveBeenCalledTimes(1)
    const url = new URL(onNavigate.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    // Strava pins only the *domain*, so any path on it is legal — and `/` is
    // already served, which is what keeps this out of worker/index.js and out
    // of the prerendered SEO pages.
    expect(url.searchParams.get('redirect_uri')).toBe(`${globalThis.location.origin}/`)
    // `activity:read`, not `_all`, silently excludes private activities — "my
    // run isn't in the list" is the confusing failure that produces.
    expect(url.searchParams.get('scope')).toBe(REQUIRED_SCOPE)

    // Minted into sessionStorage on the way out, so a callback landing in a
    // different tab correctly fails to verify.
    const state = url.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(globalThis.sessionStorage.getItem(STRAVA_STATE_STORAGE_KEY)).toBe(state)
  })

  it('mints a new state on every press, never reusing the last one', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<StravaConnectButton clientId="test-client-id" onNavigate={onNavigate} />)

    const button = screen.getByRole('button', { name: /connect with strava/i })
    await user.click(button)
    await user.click(button)

    const stateOf = (i) => new URL(onNavigate.mock.calls[i][0]).searchParams.get('state')
    expect(stateOf(0)).not.toBe(stateOf(1))
  })

  // Required whenever the connect control is shown, and a separate obligation
  // from the button artwork — it stays whatever the button ends up looking like.
  it('carries the Powered by Strava attribution', () => {
    render(<StravaConnectButton clientId="test-client-id" onNavigate={() => {}} />)
    expect(screen.getByText(/powered by strava/i)).toBeInTheDocument()
  })

  // Sending an athlete to Strava with a placeholder id lands them on Strava's
  // own "invalid client_id" page, which reads as *their* account being broken.
  // Failing here, visibly and locally, is strictly better.
  describe('an unconfigured build', () => {
    it('refuses to offer the button and names the env var', () => {
      render(<StravaConnectButton clientId="REPLACE_WITH_PRODUCTION_STRAVA_CLIENT_ID" />)

      expect(screen.queryByRole('button', { name: /connect with strava/i })).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent(/VITE_STRAVA_CLIENT_ID/)
    })

    it('does the same for an empty id', () => {
      render(<StravaConnectButton clientId="" />)
      expect(screen.queryByRole('button', { name: /connect with strava/i })).not.toBeInTheDocument()
    })

    it('recognises exactly the placeholder and nothing else', () => {
      expect(isClientIdConfigured('REPLACE_WITH_PRODUCTION_STRAVA_CLIENT_ID')).toBe(false)
      expect(isClientIdConfigured('')).toBe(false)
      expect(isClientIdConfigured('123456')).toBe(true)
    })

    // Not `.toBe(false)`: omitting the argument reads *this build's*
    // VITE_STRAVA_CLIENT_ID through the default parameter, so pinning a literal
    // here asserts what is in `.env` rather than what the function does — it
    // passed only while that file held the placeholder, and flipped to failing
    // the moment a real id was filled in. An unset id is already covered by the
    // `''` case above, because STRAVA_CLIENT_ID falls back to `''`.
    it('defers to the build-time id when called with no argument', () => {
      expect(isClientIdConfigured(undefined)).toBe(isClientIdConfigured(STRAVA_CLIENT_ID))
    })
  })
})
