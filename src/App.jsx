// Composition root. See ARCHITECTURE.md §5: swapping the ActivitySource is
// exactly changing the `source` instance passed to AppProviders below —
// nothing else in the tree touches a concrete adapter.
import { useCallback, useRef, useState } from 'react'
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
import { useIsScrolled } from './ui/useIsScrolled.js'

// Exported (not just default-exported App) so tests can drive states the
// real parsers never produce on demand — e.g. a load stuck pending — by
// wrapping it in AppProviders with a source double instead. See App.test.jsx.
export function AppShell() {
  const { activity, status, error, load } = useActivity()
  const lastRef = useRef(null)
  const isScrolled = useIsScrolled()
  // Still no router. intervals.icu overlays <main> via state, leaving the
  // status-driven branches untouched underneath. About is *not* in here: it is
  // a real static page at /about, prerendered by scripts/build-seo-pages.mjs,
  // so its prose has one home and one crawlable address rather than existing
  // twice and drifting. The enum survives the loss of its second view because
  // a third is the likeliest next change.
  const [view, setView] = useState(/** @type {'activity'|'intervals'} */ ('activity'))

  // Exactly one FileDropZone is mounted at any time: the hero in <main> while
  // idle, the compact header control otherwise. Not simply `status === 'idle'`
  // — intervals.icu replaces the whole of <main>, so without the view term a
  // visitor who opened it on a fresh page would have no load control at all.
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
  // Picking a row in the intervals.icu view both dispatches the load and
  // leaves that view, so the chart it produces is what the user lands on.
  const handleActivitySelected = useCallback(
    (ref) => {
      setView('activity')
      loadRef(ref)
    },
    [loadRef],
  )
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
              stays the single loud CTA. "intervals.icu" is also chosen to
              match none of the tests' button queries: not /back/i (the trap
              "Feedback" already sprang once) and not the drop-zone label.
              About is a real <a>, not a view swap: it is the site's only prose
              page, and a crawler has to be able to reach it by href. That also
              makes it the app's one internal link into the static pages. */}
          <button type="button" className="about-link" onClick={() => setView('intervals')}>
            intervals.icu
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
        {view === 'activity' && (
          <>
            {status === 'idle' && (
              <EmptyState
                onFileSelected={handleFileSelected}
                onOpenIntervals={() => setView('intervals')}
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
