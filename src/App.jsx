// Composition root. See ARCHITECTURE.md §5: swapping the ActivitySource is
// exactly changing the `source` instance passed to AppProviders below —
// nothing else in the tree touches a concrete adapter.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppProviders } from './app/providers.jsx'
import { createDefaultSource } from './data/sourceRegistry.js'
import { useActivity } from './state/ActivityContext.jsx'
import { ActivityHeader } from './ui/ActivityHeader.jsx'
import { BrandMark } from './ui/BrandMark.jsx'
import { ChartStack } from './ui/ChartStack.jsx'
import { ControlPanel } from './ui/ControlPanel.jsx'
import { EmptyState } from './ui/EmptyState.jsx'
import { ErrorState } from './ui/ErrorState.jsx'
import { FeedbackWidget } from './ui/FeedbackWidget.jsx'
import { FileDropZone } from './ui/FileDropZone.jsx'
import { IntervalsPage } from './ui/IntervalsPage.jsx'
import { StravaPage } from './ui/StravaPage.jsx'
import { useIsScrolled } from './ui/useIsScrolled.js'
import { useStravaOAuthCallback } from './ui/useStravaOAuthCallback.js'

// Exported (not just default-exported App) so tests can drive states the
// real parsers never produce on demand — e.g. a load stuck pending — by
// wrapping it in AppProviders with a source double instead. See App.test.jsx.
export function AppShell() {
  const { activity, status, error, load } = useActivity()
  const lastRef = useRef(null)
  const isScrolled = useIsScrolled()
  // Still no router — the third view arrived and did not change that. Each
  // picker overlays <main> via state, leaving the status-driven branches
  // untouched underneath. About is *not* in here: it is a real static page at
  // /about, prerendered by scripts/build-seo-pages.mjs, so its prose has one
  // home and one crawlable address rather than existing twice and drifting.
  const [view, setView] = useState(/** @type {'activity'|'intervals'|'strava'} */ ('activity'))

  // Exactly one FileDropZone is mounted at any time: the hero in <main> while
  // idle, the compact header control otherwise. Not simply `status === 'idle'`
  // — a picker replaces the whole of <main>, so without the view term a
  // visitor who opened one on a fresh page would have no load control at all.
  // Rendering both instead would put two competing CTAs on the idle page (the
  // thing this layout exists to fix) and give the drop-zone queries in the
  // tests two matches to choose between.
  const showEmptyState = status === 'idle' && view === 'activity'

  const loadRef = useCallback(
    (ref) => {
      lastRef.current = ref
      load(ref)
    },
    [load],
  )
  const handleFileSelected = useCallback((file) => loadRef({ type: 'file', file }), [loadRef])
  // Picking a row in either picker both dispatches the load and leaves that
  // view, so the chart it produces is what the user lands on.
  const handleActivitySelected = useCallback(
    (ref) => {
      setView('activity')
      loadRef(ref)
    },
    [loadRef],
  )

  // **Mounted here, not in StravaPage, because an OAuth return is a property of
  // the page load rather than of any view.** The athlete left from the Strava
  // page, but Strava sends them back to `/` — which renders whatever `view`
  // says, and on a cold load that is 'activity'. Mounting this inside the page
  // they cannot see would mean the code is never exchanged.
  //
  // It no-ops entirely on an ordinary load: `readCallbackParams` returns null
  // when there is no `code` and no `error` in the query, and nothing is read or
  // written before that check. A visitor who never touches Strava pays nothing
  // for it. See the module header for the StrictMode double-invoke trap.
  const { status: callbackStatus, message: callbackMessage } = useStravaOAuthCallback()

  // **Both settled outcomes land on the Strava view, not just success.** A
  // refusal has something to say — "you pressed Cancel", "that sign-in
  // couldn't be verified" — and the connect half is the only screen where
  // saying it makes sense. Dropping the athlete back on the empty state with
  // no explanation is how "I changed my mind" becomes "the app is broken".
  useEffect(() => {
    if (callbackStatus === 'connected' || callbackStatus === 'refused') setView('strava')
  }, [callbackStatus])
  // ErrorState only renders after a load(), and every load() goes through
  // loadRef, which sets lastRef.current first — so the guard is unreachable in
  // practice. It still beats seeding the ref with a ref shape the app might
  // not be able to produce.
  const handleRetry = useCallback(() => {
    if (lastRef.current) load(lastRef.current)
  }, [load])

  return (
    <div className="app">
      <header className={`app-header${isScrolled ? ' app-header--faded' : ''}`}>
        <div className="app-header__title">
          <h1>
            <BrandMark /> ActivityMaxxer
          </h1>
          {/* Gated on the view, not just on there being an activity: with the
              intervals.icu page filling <main>, a name up here would describe
              an activity that is nowhere on screen. ActivityHeader itself
              returns null without one, which covers idle/loading/error. */}
          {view === 'activity' && <ActivityHeader />}
        </div>
        <div className="app-header__actions">
          {/* Quiet text controls, deliberately not drop zones — the file path
              stays the single loud CTA. "intervals.icu" and "Strava" are also
              chosen to match none of the tests' button queries: not /back/i
              (the trap "Feedback" already sprang once) and not the drop-zone
              label. About is a real <a>, not a view swap: it is the site's only
              prose page, and a crawler has to be able to reach it by href. That
              also makes it the app's one internal link into the static pages. */}
          <button type="button" className="about-link" onClick={() => setView('intervals')}>
            intervals.icu
          </button>
          <button type="button" className="about-link" onClick={() => setView('strava')}>
            Strava
          </button>
          <a className="about-link" href="/about">
            About
          </a>
          {!showEmptyState && (
            <div className="load-activity-bar">
              <FileDropZone onFileSelected={handleFileSelected} />
            </div>
          )}
        </div>
      </header>
      <main>
        {view === 'intervals' && (
          <IntervalsPage onBack={() => setView('activity')} onSelectActivity={handleActivitySelected} />
        )}
        {view === 'strava' && (
          <StravaPage
            onBack={() => setView('activity')}
            onSelectActivity={handleActivitySelected}
            notice={callbackMessage}
          />
        )}
        {view === 'activity' && (
          <>
            {status === 'idle' && (
              <EmptyState
                onFileSelected={handleFileSelected}
                onOpenIntervals={() => setView('intervals')}
                onOpenStrava={() => setView('strava')}
              />
            )}
            {status === 'loading' && (
              <p className="loading-indicator" role="status">
                Loading activity…
              </p>
            )}
            {status === 'error' && <ErrorState error={error} onRetry={handleRetry} />}
            {status === 'ready' && activity && (
              <>
                {/* ActivityHeader is in <header> now, not here — it is what a
                    scrolled screenshot is missing, and <main> scrolls away. */}
                <ControlPanel />
                <ChartStack />
              </>
            )}
          </>
        )}
      </main>
      {/* Outside the status switch, same as the header: a visitor who hit an
          error — or never loaded anything — is exactly who most needs to be
          able to report it. */}
      <footer className="app-footer">
        <FeedbackWidget />
      </footer>
    </div>
  )
}

// The dispatch table moved to data/sourceRegistry.js the moment a second
// network provider made "an id ref means intervals.icu" false. Called bare:
// its defaults read the real credential stores, through thunks, at load time —
// so nothing about this line touches the network or storage, and a visitor who
// only ever drops files still makes zero requests.
const defaultSource = createDefaultSource()

export default function App() {
  return (
    <AppProviders source={defaultSource}>
      <AppShell />
    </AppProviders>
  )
}
