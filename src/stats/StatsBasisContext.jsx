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
import { elapsedTimeFor, statsBasisFor } from './statsBasis.js'

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
  // settle the numbers on a spare frame — so the chips lag the line by a frame
  // or two under a fast pinch, and agree with it the moment the fingers stop.
  //
  // Note what that costs, because it is not a delay: emit() writes zoomDomain
  // as an URGENT update every animation frame, and each one interrupts and
  // restarts the low-priority render this schedules. Under a continuous
  // gesture the deferred value therefore never commits at all — it settles
  // when the fingers pause, not a frame later.
  //
  // fullExtent stays OFF the deferred path on purpose: useEdgeDrag reads it
  // every animation frame of a live gesture, so it is memoized on
  // samples/xKey and never on zoomDomain.
  const statsZoomDomain = useDeferredValue(zoomDomain)
  const basis = useMemo(
    () => statsBasisFor(activity, xKey, statsZoomDomain, fullExtent),
    [activity, xKey, statsZoomDomain, fullExtent],
  )

  // The header's duration joins fullExtent off the deferred path, for the same
  // class of reason: a duration that freezes for the whole gesture and only
  // catches up on release reads as broken, in a way a chip settling late does
  // not. It can afford to be live because elapsedTimeFor is two binary
  // searches and a subtraction — no sort, no allocation, nothing that scales
  // with the window. The chips deliberately do NOT join it (§6): making them
  // live would put a sort per metric over up to ~10k samples on every frame,
  // which is the lag this release is removing.
  //
  // The deliberate consequence: mid-gesture the chips lag the duration, and
  // both are exact at rest. statsBasis.test.js pins elapsedTimeFor against
  // statsBasisFor's own field so the two can only ever differ in WHEN they
  // land, never in what they say.
  const elapsedTime = useMemo(
    () => elapsedTimeFor(activity, xKey, zoomDomain, fullExtent),
    [activity, xKey, zoomDomain, fullExtent],
  )

  // `basis` keeps its own identity inside this object rather than being spread
  // into it, so useMetricStats' memo and MetricPanel's statsBasis prop still
  // change only on settle even though `value` now changes every frame.
  const value = useMemo(
    () => ({ xKey, fullExtent, basis, elapsedTime }),
    [xKey, fullExtent, basis, elapsedTime],
  )

  return <StatsBasisContext.Provider value={value}>{children}</StatsBasisContext.Provider>
}

export function useStatsBasis() {
  const ctx = useContext(StatsBasisContext)
  if (ctx === undefined) {
    throw new Error('useStatsBasis must be used within a StatsBasisProvider')
  }
  return ctx
}
