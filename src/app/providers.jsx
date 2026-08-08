// Composes ActivitySourceProvider + ActivityProvider + ChartViewProvider +
// StatsBasisProvider. Swapping mock -> tcx -> intervals is done entirely by
// changing the `source` instance passed to <AppProviders> — see
// ARCHITECTURE.md §5.
//
// The nesting order is load-bearing, not incidental: ChartViewProvider reads
// the activity to know whose remembered view it is holding, and
// StatsBasisProvider derives its window from both, so it goes innermost.
import { ActivitySourceProvider } from '../data/ActivitySource.js'
import { ActivityProvider } from '../state/ActivityContext.jsx'
import { ChartViewProvider } from '../state/ChartViewContext.jsx'
import { StatsBasisProvider } from '../stats/StatsBasisContext.jsx'

export function AppProviders({ source, children }) {
  return (
    <ActivitySourceProvider source={source}>
      <ActivityProvider>
        <ChartViewProvider>
          <StatsBasisProvider>{children}</StatsBasisProvider>
        </ChartViewProvider>
      </ActivityProvider>
    </ActivitySourceProvider>
  )
}
