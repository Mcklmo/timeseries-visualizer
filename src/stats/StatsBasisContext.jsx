// Publishes the one windowed stats basis (statsBasis.js) the whole app reads.
// It is *derived* state, not state: everything here is a pure function of the
// activity and the zoom domain, which is why it is a context of its own rather
// than fields on ChartViewContext (§10).
//
// It lives above ChartStack because the header now reports the window too —
// the elapsed duration next to the activity name. A second, independent memo
// in the header would double the slice (up to ~10k samples per settled zoom)
// and, worse, would be free to drift from what the stat chips report.
import { createContext, useContext, useDeferredValue, useMemo } from 'react'
import { extentOf } from '../domain/zoomDomain.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { statsBasisFor } from './statsBasis.js'

const StatsBasisContext = createContext(undefined)

export function StatsBasisProvider({ children }) {
  const { activity } = useActivity()
  const { xMode, zoomDomain } = useChartView()

  // Computed from activity.samples rather than the panels' chart rows, which
  // carry insertGapBreaks' synthetic midpoints (see extentOf's contract).
  const xKey = xMode === 'distance' ? 'd' : 't'
  const fullExtent = useMemo(() => extentOf(activity?.samples ?? [], xKey), [activity?.samples, xKey])

  // The stats' window, sliced once for the whole app rather than once per
  // consumer. Deferred because the two jobs have different deadlines: the
  // chart's x-domain must track the gesture at framerate, while aggregation (a
  // sort per metric over the full-resolution series) must not run on every
  // pinch frame. useDeferredValue lets React paint the new domain first and
  // settle the numbers on a spare frame — so the chips and the header's
  // duration lag the line by a frame or two under a fast pinch, and agree with
  // it the moment the fingers stop.
  //
  // fullExtent stays OFF the deferred path on purpose: usePinchZoom reads it
  // every animation frame of a live gesture, so it is memoized on
  // samples/xKey and never on zoomDomain.
  const statsZoomDomain = useDeferredValue(zoomDomain)
  const basis = useMemo(
    () => statsBasisFor(activity, xKey, statsZoomDomain, fullExtent),
    [activity, xKey, statsZoomDomain, fullExtent],
  )

  const value = useMemo(() => ({ xKey, fullExtent, basis }), [xKey, fullExtent, basis])

  return <StatsBasisContext.Provider value={value}>{children}</StatsBasisContext.Provider>
}

export function useStatsBasis() {
  const ctx = useContext(StatsBasisContext)
  if (ctx === undefined) {
    throw new Error('useStatsBasis must be used within a StatsBasisProvider')
  }
  return ctx
}
