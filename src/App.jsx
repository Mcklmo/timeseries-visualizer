// Composition root. See ARCHITECTURE.md §5: swapping the ActivitySource is
// exactly changing the `source` instance passed to AppProviders below —
// nothing else in the tree touches a concrete adapter.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppProviders } from './app/providers.jsx'
import { FitActivitySource } from './data/fit/FitActivitySource.js'
import { MockActivitySource } from './data/mock/MockActivitySource.js'
import { TcxActivitySource } from './data/tcx/TcxActivitySource.js'
import { useActivity } from './state/ActivityContext.jsx'
import { AboutPage } from './ui/AboutPage.jsx'
import { ActivityHeader } from './ui/ActivityHeader.jsx'
import { ChartStack } from './ui/ChartStack.jsx'
import { ControlPanel } from './ui/ControlPanel.jsx'
import { ErrorState } from './ui/ErrorState.jsx'
import { LoadActivityBar } from './ui/LoadActivityBar.jsx'

const SAMPLE_REF = { type: 'id', id: 'sample' }

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
// real MockActivitySource never produces — e.g. a rejected load — by
// wrapping it in AppProviders with a source double instead. See App.test.jsx.
export function AppShell() {
  const { activity, status, error, load } = useActivity()
  const lastRef = useRef(SAMPLE_REF)
  const isScrolled = useIsScrolled()
  // No router here (see AboutPage.jsx) — About overlays <main> via state,
  // leaving the status-driven branches untouched underneath.
  const [showAbout, setShowAbout] = useState(false)

  const loadRef = useCallback(
    (ref) => {
      lastRef.current = ref
      load(ref)
    },
    [load],
  )
  const handleFileSelected = useCallback((file) => loadRef({ type: 'file', file }), [loadRef])
  const handleLoadSample = useCallback(() => loadRef(SAMPLE_REF), [loadRef])
  const handleRetry = useCallback(() => load(lastRef.current), [load])

  return (
    <div className="app">
      <header className={`app-header${isScrolled ? ' app-header--faded' : ''}`}>
        <div className="app-header__title">
          <h1>Activity Visualiser</h1>
          <button type="button" className="about-link" onClick={() => setShowAbout(true)}>
            About
          </button>
        </div>
        <LoadActivityBar onFileSelected={handleFileSelected} onLoadSample={handleLoadSample} />
      </header>
      <main>
        {showAbout ? (
          <AboutPage onBack={() => setShowAbout(false)} />
        ) : (
          <>
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
    </div>
  )
}

// Composition-root dispatcher: a dropped/browsed file (`{type:'file'}`) goes
// to the real TCX or FIT parser (by extension); the "Load sample activity"
// button (`{type:'id'}`) still resolves the bundled mock fixture. All
// concrete adapters are instantiated only here — see ARCHITECTURE.md §5.
const isFitFile = (file) => file.name.toLowerCase().endsWith('.fit')

const tcxSource = new TcxActivitySource()
const fitSource = new FitActivitySource()
const mockSource = new MockActivitySource()
const defaultSource = {
  kind: 'tcx',
  load: (ref) => {
    if (ref.type !== 'file') return mockSource.load(ref)
    return isFitFile(ref.file) ? fitSource.load(ref) : tcxSource.load(ref)
  },
}

export default function App() {
  return (
    <AppProviders source={defaultSource}>
      <AppShell />
    </AppProviders>
  )
}
