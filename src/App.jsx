// Composition root. See ARCHITECTURE.md §5: swapping the ActivitySource is
// exactly changing the `source` instance passed to AppProviders below —
// nothing else in the tree touches a concrete adapter.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppProviders } from './app/providers.jsx'
import { FitActivitySource } from './data/fit/FitActivitySource.js'
import { GpxActivitySource } from './data/gpx/GpxActivitySource.js'
import { credentialStore } from './data/intervals/credentialStore.js'
import { IntervalsActivitySource } from './data/intervals/IntervalsActivitySource.js'
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
import { IntervalsPage } from './ui/IntervalsPage.jsx'

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
  // No router here (see AboutPage.jsx) — the non-chart views overlay <main>
  // via state, leaving the status-driven branches untouched underneath. One
  // enum rather than a boolean per view, so `about && intervals` is
  // unrepresentable rather than merely unlikely.
  const [view, setView] = useState(/** @type {'activity'|'about'|'intervals'} */ ('activity'))

  // Exactly one FileDropZone is mounted at any time: the hero in <main> while
  // idle, the compact header control otherwise. Not simply `status === 'idle'`
  // — About and intervals.icu each replace the whole of <main>, so without the
  // view term a visitor who opened one on a fresh page would have no load
  // control at all. Rendering both instead would put two competing CTAs on the
  // idle page (the thing this layout exists to fix) and give the drop-zone
  // queries in the tests two matches to choose between.
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
          <h1>Activity Visualiser</h1>
          {/* Quiet text buttons, deliberately not drop zones — the file path
              stays the single loud CTA. "intervals.icu" is also chosen to
              match none of the tests' button queries: not /back/i (the trap
              "Feedback" already sprang once), not /^about$/i, and not the
              drop-zone label. */}
          <button type="button" className="about-link" onClick={() => setView('intervals')}>
            intervals.icu
          </button>
          <button type="button" className="about-link" onClick={() => setView('about')}>
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
        {view === 'about' && <AboutPage onBack={() => setView('activity')} />}
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

// Composition-root dispatcher. A dropped/browsed file (`{type:'file'}`) goes
// to the real TCX, FIT or GPX parser, chosen by extension; a file with an
// unrecognised extension falls through to TcxActivitySource, which rejects it
// with a real error. An `{type:'id'}` ref comes from the intervals.icu picker
// and goes to IntervalsActivitySource, which downloads the original file and
// sniffs its format from the bytes — the ref itself carries no format hint,
// which is what makes ErrorState's "Try again" work on that path too.
// All concrete adapters are instantiated only here — see ARCHITECTURE.md §5.
const tcxSource = new TcxActivitySource()
const fitSource = new FitActivitySource()
const gpxSource = new GpxActivitySource()
// The key is read through a function, at call time — never captured here, so
// a Disconnect takes effect on the very next load. Nothing about this
// construction touches the network or storage, which is what keeps a visitor
// who only ever drops files at zero requests.
const intervalsSource = new IntervalsActivitySource({ getApiKey: () => credentialStore.readApiKey() })

const SOURCE_BY_EXTENSION = { '.fit': fitSource, '.gpx': gpxSource, '.tcx': tcxSource }

function sourceFor(ref) {
  if (ref.type === 'id') return intervalsSource
  if (ref.type !== 'file') return tcxSource
  const name = ref.file.name.toLowerCase()
  const extension = Object.keys(SOURCE_BY_EXTENSION).find((ext) => name.endsWith(ext))
  return extension ? SOURCE_BY_EXTENSION[extension] : tcxSource
}

const defaultSource = {
  kind: 'tcx',
  load: (ref) => sourceFor(ref).load(ref),
}

export default function App() {
  return (
    <AppProviders source={defaultSource}>
      <AppShell />
    </AppProviders>
  )
}
