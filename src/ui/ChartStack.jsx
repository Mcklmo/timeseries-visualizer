// Vertically stacks one MetricPanel per active metric, sharing syncId and a
// controlled x-domain so panels read as one instrument. See ARCHITECTURE.md
// §7. It also carries the chart's whole chrome now — the ChartToolbar row
// above the panels, and, through each panel's head, that graph's own settings.
// There is no separate settings window any more. Zooming is a two-finger pinch (or ctrl/⌘+scroll) anywhere on the stack,
// handled by usePinchZoom, which writes the one zoomDomain every panel's XAxis
// reads — so all panels zoom and pan together by construction.
import { useCallback } from 'react'
import { fullDomain, isFullDomain } from '../domain/zoomDomain.js'
import { derivativeKindFor, isMetricForSport, metricOrder, metricRegistry } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { useStatsBasis } from '../stats/StatsBasisContext.jsx'
import { ChartToolbar } from './ChartToolbar.jsx'
import { Y_AXIS_RIGHT_WIDTH } from './chartGeometry.js'
import { MetricPanel } from './MetricPanel.jsx'
import { useIsNarrow } from './useIsNarrow.js'
import { usePinchZoom } from './usePinchZoom.js'
import { useTouchHoverHandoff } from './useTouchHoverHandoff.js'
import { useTouchScrub } from './useTouchScrub.js'

const FIRST_PANEL_HEIGHT = 200
const OTHER_PANEL_HEIGHT = 140
// §9's "panel heights reduced ~25% below 720px". It can't be a media query:
// these are JS numbers handed to <ResponsiveContainer height>.
const NARROW_FIRST_PANEL_HEIGHT = 150
const NARROW_OTHER_PANEL_HEIGHT = 105

/**
 * @param {object} props
 * @param {Element|null} [props.positionSlot] - the app header's shared
 *   `12:05 · 2.34 km` slot node, owned by AppShell (the two ends of that portal
 *   are in different subtrees now, so this arrives as a prop). Defaults to null
 *   for the same reason MetricPanel's does: plenty of tests render the stack
 *   bare, and a stack with no slot is still a perfectly good stack.
 */
export function ChartStack({ positionSlot = null }) {
  const { activity } = useActivity()
  const { xMode, zoomDomain, enabledMetrics, enabledStats, setZoomDomain, toggleStat } = useChartView()
  const isNarrow = useIsNarrow()

  // Both the extent the gesture solves against and the window the chips report
  // come from StatsBasisContext, above this component — the header reports the
  // same window (its elapsed duration), and one basis is what keeps the two
  // from drifting. Called above the `if (!activity)` guard below, since a hook
  // is a hook wherever its value comes from.
  const { fullExtent, basis: statsBasis } = useStatsBasis()

  // Hoisted ABOVE the `if (!activity)` guard, with `activity?.`, because the
  // gutter width below feeds usePinchZoom and a hook cannot be called
  // conditionally. Optional chaining rather than a second copy of the filter
  // further down: two copies would be free to disagree about which panels are
  // on screen, and the gutter has to be reserved on exactly the ones that are.
  const visibleMetrics = metricOrder.filter(
    (id) =>
      activity?.availableMetrics.includes(id) && enabledMetrics.includes(id) && isMetricForSport(id, activity.sport),
  )

  // ONE width for the whole stack, not one per panel. The moment any visible
  // panel has a derivative overlay, every visible panel reserves the gutter;
  // when none do, none reserve it. Both halves matter — see Y_AXIS_RIGHT_WIDTH
  // in chartGeometry.js for why (the gesture measures a single surface, and §7
  // requires the plot areas to align pixel-for-pixel for the shared crosshair).
  const rightInset = visibleMetrics.some(
    (id) => derivativeKindFor(metricRegistry[id], enabledStats[id] ?? []) != null,
  )
    ? Y_AXIS_RIGHT_WIDTH
    : 0

  const { ref: pinchRef, wheelHint } = usePinchZoom({
    domain: zoomDomain,
    fullExtent,
    onZoomChange: setZoomDomain,
    rightInset,
  })
  const handoffRef = useTouchHoverHandoff()
  const scrubRef = useTouchScrub({ rightInset })

  // Three callback refs, one node. All three return a React 19 cleanup, so all
  // three have to be collected and all three have to run — dropping any leaks
  // its listeners on every remount. All are useCallback(…, []), so this stays
  // stable too and the listeners are never torn down mid-gesture. Their ORDER
  // does not matter, even though two of them call stopPropagation():
  // stopPropagation never affects other listeners on the same target, which is
  // already why the pinch guard and the handoff coexist here.
  const stackRef = useCallback(
    (node) => {
      const cleanups = [pinchRef(node), handoffRef(node), scrubRef(node)]
      return () => {
        for (const cleanup of cleanups) cleanup?.()
      }
    },
    [pinchRef, handoffRef, scrubRef],
  )

  if (!activity) return null

  return (
    <div
      className="chart-stack"
      ref={stackRef}
      // Documents the touch gesture as well as the desktop one, and costs
      // nothing in a screenshot — unlike a permanent hint line under the stack.
      // role="group" is what makes the aria-label reachable at all: a bare div
      // is `generic`, and an accessible name on a generic element is dropped.
      role="group"
      title="Pinch, or Ctrl + scroll, to zoom. While zoomed, scroll sideways to pan. Swipe one finger sideways to move the crosshair"
      aria-label="Activity charts. Pinch, or Ctrl and scroll, to zoom the time axis. While zoomed, scroll sideways to pan. Swipe one finger sideways to move the crosshair, which follows the swipe rather than jumping to the finger."
    >
      {/* Inside the stack, not in App.jsx, so `touch-action: pan-y` below covers
          this row too — which is what closed the limit ARCHITECTURE.md §13
          recorded ("a pinch begun on the ControlPanel still page-zooms"). That
          is now the only reason: the position slot it used to hold moved to the
          app header, so reachability from a panel's readout bridge no longer
          keeps it here. */}
      <ChartToolbar />
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
            statsBasis={statsBasis}
            enabledStats={enabledStats[metricId] ?? []}
            onToggleStat={toggleStat}
            rightInset={rightInset}
            showXAxis={isBottom}
            height={height}
            // Every panel is synced to the same sample, so any one of them can
            // drive the shared position readout; the first is the stable choice,
            // and it re-homes by itself when a metric is toggled off.
            positionSlot={i === 0 ? positionSlot : null}
          />
        )
      })}
      {/* With no double-tap and no one-finger pan, unwinding a 50× zoom takes
          three or four successive pinch-outs — so there is an explicit way
          back. Rendered only while zoomed, which keeps it out of an idle
          screenshot, and absolutely positioned over the plot rather than added
          to the toolbar row above: it acts on what the user is looking at, and
          a conditional control in that always-present row would change its
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
