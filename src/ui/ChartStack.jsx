// Vertically stacks one MetricPanel per active metric, sharing syncId and a
// controlled x-domain so panels read as one instrument. See ARCHITECTURE.md
// §7. Zooming is a two-finger pinch (or ctrl/⌘+scroll) anywhere on the stack,
// handled by usePinchZoom, which writes the one zoomDomain every panel's XAxis
// reads — so all panels zoom and pan together by construction.
import { useMemo } from 'react'
import { extentOf, fullDomain, isFullDomain } from '../domain/zoomDomain.js'
import { isMetricForSport, metricOrder } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { MetricPanel } from './MetricPanel.jsx'
import { useIsNarrow } from './useIsNarrow.js'
import { usePinchZoom } from './usePinchZoom.js'

const FIRST_PANEL_HEIGHT = 200
const OTHER_PANEL_HEIGHT = 140
// §9's "panel heights reduced ~25% below 720px". It can't be a media query:
// these are JS numbers handed to <ResponsiveContainer height>.
const NARROW_FIRST_PANEL_HEIGHT = 150
const NARROW_OTHER_PANEL_HEIGHT = 105

export function ChartStack() {
  const { activity } = useActivity()
  const { xMode, zoomDomain, enabledMetrics, enabledStats, setZoomDomain } = useChartView()
  const isNarrow = useIsNarrow()

  // Above the `if (!activity)` guard below — rules of hooks. Computed from
  // activity.samples rather than the panels' chart rows, which carry
  // insertGapBreaks' synthetic midpoints (see extentOf's contract).
  const xKey = xMode === 'distance' ? 'd' : 't'
  const fullExtent = useMemo(() => extentOf(activity?.samples ?? [], xKey), [activity?.samples, xKey])

  const { ref: pinchRef, wheelHint } = usePinchZoom({
    domain: zoomDomain,
    fullExtent,
    onZoomChange: setZoomDomain,
  })

  if (!activity) return null

  const visibleMetrics = metricOrder.filter(
    (id) =>
      activity.availableMetrics.includes(id) && enabledMetrics.includes(id) && isMetricForSport(id, activity.sport),
  )

  return (
    <div
      className="chart-stack"
      ref={pinchRef}
      // Documents the touch gesture as well as the desktop one, and costs
      // nothing in a screenshot — unlike a permanent hint line under the stack.
      // role="group" is what makes the aria-label reachable at all: a bare div
      // is `generic`, and an accessible name on a generic element is dropped.
      role="group"
      title="Pinch, or Ctrl + scroll, to zoom"
      aria-label="Activity charts. Pinch, or Ctrl and scroll, to zoom the time axis."
    >
      {visibleMetrics.map((metricId, i) => {
        const isBottom = i === visibleMetrics.length - 1
        const height =
          i === 0
            ? (isNarrow ? NARROW_FIRST_PANEL_HEIGHT : FIRST_PANEL_HEIGHT)
            : (isNarrow ? NARROW_OTHER_PANEL_HEIGHT : OTHER_PANEL_HEIGHT)
        return (
          <MetricPanel
            key={metricId}
            activity={activity}
            metricId={metricId}
            xMode={xMode}
            zoomDomain={zoomDomain}
            enabledStats={enabledStats[metricId] ?? []}
            showXAxis={isBottom}
            height={height}
          />
        )
      })}
      {/* With no double-tap and no one-finger pan, unwinding a 50× zoom takes
          three or four successive pinch-outs — so there is an explicit way
          back. Rendered only while zoomed, which keeps it out of an idle
          screenshot, and positioned inside the stack rather than added to the
          ControlPanel: it acts on what the user is looking at, and a
          conditional button in that always-present panel would change its
          height and reflow every chart below it on the first pinch. */}
      {!isFullDomain(zoomDomain) && (
        <button type="button" className="zoom-reset" onClick={() => setZoomDomain(fullDomain())}>
          Reset zoom
        </button>
      )}
      {/* Appears exactly when the user's mental model says "I expected that to
          zoom" — on a plain scroll over the charts — and never again once
          they've zoomed successfully. A permanent hint line under the stack
          was rejected: it would be clutter in every screenshot. */}
      {wheelHint && (
        <p className="zoom-hint" role="status">
          Use Ctrl + scroll to zoom
        </p>
      )}
    </div>
  )
}
