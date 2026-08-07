// Composition root. See ARCHITECTURE.md §5: swapping the ActivitySource is
// exactly changing the `source` instance passed to AppProviders below —
// nothing else in the tree touches a concrete adapter.
import { useCallback, useRef, useState } from 'react'
import { AppProviders } from './app/providers.jsx'
import { FitActivitySource } from './data/fit/FitActivitySource.js'
import { MockActivitySource } from './data/mock/MockActivitySource.js'
import { TcxActivitySource } from './data/tcx/TcxActivitySource.js'
import { useActivity } from './state/ActivityContext.jsx'
import { ChartStack } from './ui/ChartStack.jsx'
import { ControlPanel } from './ui/ControlPanel.jsx'
import { EmptyState } from './ui/EmptyState.jsx'
import { ErrorState } from './ui/ErrorState.jsx'

const SAMPLE_REF = { type: 'id', id: 'sample' }

// Exported (not just default-exported App) so tests can drive states the
// real MockActivitySource never produces — e.g. a rejected load — by
// wrapping it in AppProviders with a source double instead. See App.test.jsx.
export function AppShell() {
  const { activity, status, error, load } = useActivity()
  const lastRef = useRef(SAMPLE_REF)

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
      <header className="app-header">
        <h1>Activity Visualiser</h1>
      </header>
      <main>
        {status === 'idle' && <EmptyState onFileSelected={handleFileSelected} onLoadSample={handleLoadSample} />}
        {status === 'loading' && (
          <p className="loading-indicator" role="status">
            Loading activity…
          </p>
        )}
        {status === 'error' && <ErrorState error={error} onRetry={handleRetry} />}
        {status === 'ready' && activity && (
          <>
            <ControlPanel />
            <ChartStack />
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
