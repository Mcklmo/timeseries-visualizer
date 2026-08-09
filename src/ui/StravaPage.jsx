// The Strava view, swapped into <main> exactly as IntervalsPage is — no router
// in this app, so "navigation" is plain state (see App.jsx's `view`).
//
// Two halves, and the same state machine as its sibling: not connected means
// the connect half, connected means the activity list. What differs is what
// the state machine keys on. intervals.icu's is an API key the athlete pasted;
// this one is a token triple with an expiry and a rotating refresh token, so
// the page holds a boolean and `useStravaActivities` reads the store at call
// time. A token held in React state is a token that goes stale mid-render.
//
// All the read orchestration — the effect, the merge, the range, the coded
// errors, the disconnect ordering — is in useStravaActivities. What is left
// here is copy, layout, and the wording that is genuinely Strava's rather than
// any provider's.
//
// **There is no search box, and its absence is not an omission.** Strava has no
// activity search endpoint at all. Rendering a disabled one, or one that
// filtered only the loaded window, would both claim a capability that doesn't
// exist — the second more convincingly and therefore worse.
import { formatRangeLabel, isRangeActive } from '../data/activityDateRange.js'
import { STRAVA_APP_SETTINGS_URL } from '../data/strava/stravaApi.js'
import { ActivityDateFilter } from './ActivityDateFilter.jsx'
import { ActivityRowList } from './ActivityRowList.jsx'
import { StravaConnectButton } from './StravaConnectButton.jsx'
import { useStravaActivities } from './useStravaActivities.js'

// Strava's API Policy §4.4: data derived from Garmin devices carries Garmin
// attribution. The *question* is shared with intervals.icu — which is why
// ActivityRow answers it once, in `isGarminDerived` — but the sentence differs
// per provider, so it lives here rather than in the shared row.
//
// Shown only when this athlete actually has Garmin-synced activities in view,
// so it stays a true statement rather than boilerplate.
function hasGarminData(rows) {
  return rows.some((row) => row.isGarminDerived)
}

/**
 * Every collaborator of the hook is threaded through as an optional prop, the
 * same seam arrangement IntervalsPage uses: App.jsx passes none of them, and
 * the suite drives the whole view through fakes.
 *
 * @param {{
 *   onBack: () => void,
 *   onSelectActivity: (ref: import('../data/ActivitySource.js').IdActivityRef) => void,
 *   notice?: string|null,
 *   store?: object,
 *   listCache?: object,
 *   streamCache?: object,
 *   rangeStore?: object,
 *   fetchImpl?: typeof fetch,
 *   connectButtonProps?: object,
 * }} props
 */
export function StravaPage({
  onBack,
  onSelectActivity,
  notice: externalNotice = null,
  connectButtonProps,
  ...hookOptions
}) {
  const {
    isConnected,
    rows,
    error,
    notice,
    range,
    setRange,
    isLoadingEarlier,
    isAwaitingFirstWindow,
    disconnect,
    loadEarlier,
  } = useStravaActivities(hookOptions)

  // Names the range rather than claiming "the last few months" were empty. With
  // the filter on by default there is nearly always a range to name; the
  // fallback survives for a pair of fields the athlete emptied by hand.
  const rangeLabel = isRangeActive(range) ? formatRangeLabel(range) : null
  const emptyMessage = rangeLabel ? `No activities ${rangeLabel}.` : undefined

  // The hook's own notice (a rejected grant, a full app) and the OAuth
  // callback's (a cancelled sign-in, a failed state check) are the same kind of
  // message arriving from two directions. The hook's wins when both are set,
  // because it is the more recent event.
  const connectNotice = notice ?? externalNotice

  return (
    <div className="intervals-page">
      <button type="button" className="about-page__back" onClick={onBack}>
        ← Back
      </button>
      <h2>Strava</h2>

      {!isConnected ? (
        <>
          {connectNotice && (
            <p className="intervals-page__error" role="alert">
              {connectNotice}
            </p>
          )}

          <StravaConnectButton {...connectButtonProps} />

          <p className="intervals-page__hint">
            {/* The honest cost, stated before the athlete connects rather than
                on an About page they may never open. It is also the one place
                Strava's story is *better* than intervals.icu's, so both halves
                are said plainly. */}
            Unlike the intervals.icu route, this one goes through this app&apos;s server — Strava
            requires a secret that can&apos;t live in a web page. The server passes requests
            through and stores nothing. Your access token is kept in this browser, expires every
            six hours, and can only ever read.
          </p>

          <p className="intervals-page__hint">
            Strava limits how many accounts an app like this can connect. If it&apos;s already
            full you&apos;ll be told so when you try — that&apos;s a limit on this app, not on
            your account.
          </p>
        </>
      ) : (
        <>
          <div className="intervals-page__account">
            <button type="button" className="intervals-page__disconnect" onClick={disconnect}>
              Disconnect
            </button>
            <p className="intervals-page__hint">
              Revokes this app&apos;s access <strong>at Strava</strong>, not just here, and clears
              everything it had loaded. You can check or undo it any time under{' '}
              <a href={STRAVA_APP_SETTINGS_URL} target="_blank" rel="noreferrer noopener">
                My Apps
              </a>{' '}
              in your Strava settings.
            </p>
          </div>

          {error && (
            <p className="intervals-page__error" role="alert">
              {error}
            </p>
          )}

          <ActivityDateFilter range={range} onChange={setRange} />

          {isAwaitingFirstWindow && (
            <p className="loading-indicator" role="status">
              Loading activities…
            </p>
          )}

          {!isAwaitingFirstWindow && (
            <ActivityRowList
              rows={rows}
              isLoadingEarlier={isLoadingEarlier}
              // Always offered here, unlike the intervals.icu list, which hides
              // it while searching — there is no search on this provider, so
              // the range always *is* the window and widening it always means
              // paging.
              onLoadEarlier={loadEarlier}
              emptyMessage={emptyMessage}
              // **All four fields, and three of them fail silently if missed.**
              // `provider` — sourceRegistry throws without it rather than
              //   guessing, because guessing means reading another athlete's
              //   account.
              // `startedAtUtc` — Strava's `time` stream is offsets from the
              //   start, so without this the adapter has nothing to add them
              //   to. It refuses rather than charting from the epoch.
              // `sportType` — decides cadence doubling. Miss it and every run
              //   charts at ~85 spm instead of ~170, and *nothing throws*. It
              //   travels as the humanized label the row already carries;
              //   `sportFor` accepts both spellings precisely so one value
              //   moves rather than two that can disagree.
              // `name` needs no `|| undefined` guard: the mapper already drops
              //   an empty title, so a blank one can never override the name
              //   deriveWorkoutName infers.
              onSelect={(row) =>
                onSelectActivity({
                  type: 'id',
                  provider: 'strava',
                  id: row.id,
                  name: row.name,
                  startedAtUtc: row.startedAtUtc,
                  sportType: row.sportLabel,
                })
              }
            />
          )}

          {/* Tracks what is actually on screen, so the credit stays a true
              statement rather than boilerplate (API Policy §4.4). */}
          {hasGarminData(rows) && (
            <p className="intervals-page__attribution">Activity data from Garmin, via Strava.</p>
          )}

          {/* Required whenever Strava data is displayed, which is here. */}
          <p className="intervals-page__attribution">Powered by Strava</p>
        </>
      )}
    </div>
  )
}
