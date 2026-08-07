// Composition root. See ARCHITECTURE.md §5: swapping the ActivitySource is
// exactly changing the `source` instance passed to AppProviders below —
// nothing else in the tree touches a concrete adapter.
import { useCallback, useRef, useState } from 'react'
import { AppProviders } from './app/providers.jsx'
import { MockActivitySource } from './data/mock/MockActivitySource.js'
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

const defaultSource = new MockActivitySource()

export default function App() {
  return (
    <AppProviders source={defaultSource}>
      <AppShell />
    </AppProviders>
  )
}
