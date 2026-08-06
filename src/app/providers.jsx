// Composes ActivitySourceProvider + ActivityProvider + ChartViewProvider.
// Swapping mock -> tcx -> http is done entirely by changing the `source`
// instance passed to <AppProviders> — see ARCHITECTURE.md §5.
import { ActivitySourceProvider } from '../data/ActivitySource.js'
import { ActivityProvider } from '../state/ActivityContext.jsx'
import { ChartViewProvider } from '../state/ChartViewContext.jsx'

export function AppProviders({ source, children }) {
  return (
    <ActivitySourceProvider source={source}>
      <ActivityProvider>
        <ChartViewProvider>{children}</ChartViewProvider>
      </ActivityProvider>
    </ActivitySourceProvider>
  )
}
