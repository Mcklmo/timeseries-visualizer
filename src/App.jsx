// Composition root. See ARCHITECTURE.md §5: swapping the ActivitySource is
// exactly changing the `source` instance passed to AppProviders below —
// nothing else in the tree touches a concrete adapter.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppProviders } from './app/providers.jsx'
import { FitActivitySource } from './data/fit/FitActivitySource.js'
import { TcxActivitySource } from './data/tcx/TcxActivitySource.js'
import { useActivity } from './state/ActivityContext.jsx'
import { AboutPage } from './ui/AboutPage.jsx'
import { ActivityHeader } from './ui/ActivityHeader.jsx'
import { ChartStack } from './ui/ChartStack.jsx'
import { ControlPanel } from './ui/ControlPanel.jsx'
import { EmptyState } from './ui/EmptyState.jsx'
import { ErrorState } from './ui/ErrorState.jsx'
import { FeedbackWidget } from './ui/FeedbackWidget.jsx'
import { FileDropZone } from './ui/FileDropZone.jsx'

// Below this, the header stays fully opaque — only fades once the user has
// actually scrolled away from the top, not on a stray 1px wheel tick.
const HEADER_FADE_SCROLL_THRESHOLD = 8

// Drives .app-header--faded (see global.css): once scrolled, the header's
// background/border and the load-activity-bar collapse away entirely,
// giving that space back to the charts — only the h1 stays put, as a
// persistent watermark/logo. Hovering or focusing the header brings
// everything back without needing to scroll to the top first.
function useIsScrolled(threshold = HEADER_FADE_SCROLL_THRESHOLD) {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > threshold)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [threshold])

  return isScrolled
}

// Exported (not just default-exported App) so tests can drive states the
// real parsers never produce on demand — e.g. a load stuck pending — by
// wrapping it in AppProviders with a source double instead. See App.test.jsx.
export function AppShell() {
  const { activity, status, error, load } = useActivity()
  const lastRef = useRef(null)
  const isScrolled = useIsScrolled()
  // No router here (see AboutPage.jsx) — About overlays <main> via state,
  // leaving the status-driven branches untouched underneath.
  const [showAbout, setShowAbout] = useState(false)

  // Exactly one FileDropZone is mounted at any time: the hero in <main> while
  // idle, the compact header control otherwise. Not simply `status === 'idle'`
  // — About replaces the whole of <main>, so without the `!showAbout` term a
  // visitor who opened About on a fresh page would have no load control at
  // all. Rendering both instead would put two competing CTAs on the idle page
  // (the thing this layout exists to fix) and give the drop-zone queries in
  // the tests two matches to choose between.
  const showEmptyState = status === 'idle' && !showAbout

  const loadRef = useCallback(
    (ref) => {
      lastRef.current = ref
      load(ref)
    },
    [load],
  )
  const handleFileSelected = useCallback((file) => loadRef({ type: 'file', file }), [loadRef])
  // ErrorState only renders after a load(), and every load() goes through
  // loadRef, which sets lastRef.current first — so the guard is unreachable in
  // practice. It still beats seeding the ref with a ref shape (the old sample
  // {type:'id'}) the app can no longer produce.
  const handleRetry = useCallback(() => {
    if (lastRef.current) load(lastRef.current)
  }, [load])

  return (
    <div className="app">
      <header className={`app-header${isScrolled ? ' app-header--faded' : ''}`}>
        <div className="app-header__title">
          <h1>Activity Visualiser</h1>
          <button type="button" className="about-link" onClick={() => setShowAbout(true)}>
            About
          </button>
        </div>
        {!showEmptyState && (
          <div className="load-activity-bar">
            <FileDropZone onFileSelected={handleFileSelected} />
          </div>
        )}
      </header>
      <main>
        {showAbout ? (
          <AboutPage onBack={() => setShowAbout(false)} />
        ) : (
          <>
            {status === 'idle' && <EmptyState onFileSelected={handleFileSelected} />}
            {status === 'loading' && (
              <p className="loading-indicator" role="status">
                Loading activity…
              </p>
            )}
            {status === 'error' && <ErrorState error={error} onRetry={handleRetry} />}
            {status === 'ready' && activity && (
              <>
                <ActivityHeader />
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

// Composition-root dispatcher: a dropped/browsed file (`{type:'file'}`) goes
// to the real TCX or FIT parser, chosen by extension. Anything else falls
// through to TcxActivitySource, which rejects a non-`file` ref with a real
// error — the UI can only ever produce file refs now, but routing them there
// beats dropping the branch, which would leave isFitFile reading `.name` off
// an undefined `ref.file`. All concrete adapters are instantiated only here —
// see ARCHITECTURE.md §5.
const isFitFile = (file) => file.name.toLowerCase().endsWith('.fit')

const tcxSource = new TcxActivitySource()
const fitSource = new FitActivitySource()
const defaultSource = {
  kind: 'tcx',
  load: (ref) =>
    ref.type === 'file' && isFitFile(ref.file) ? fitSource.load(ref) : tcxSource.load(ref),
}

export default function App() {
  return (
    <AppProviders source={defaultSource}>
      <AppShell />
    </AppProviders>
  )
}
