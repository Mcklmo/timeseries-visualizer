// Vertically stacks one MetricPanel per active metric, sharing syncId and a
// controlled x-domain so panels read as one instrument. See ARCHITECTURE.md
// §7. It also carries the chart's whole chrome now — the ChartToolbar row
// above the panels, and, through each panel's head, that graph's own settings.
// There is no separate settings window any more. Zooming is dragging one of the
// window's edge handles (useEdgeDrag, drawn by ZoomWindowOverlay) and nothing
// else; a sideways scroll pans it (useWheelPan). Both write the one zoomDomain
// every panel's XAxis reads — so all panels zoom and pan together by
// construction.
import { useCallback } from 'react'
import {
  fullDomain,
  isFullDomain,
  minSpanFor,
  moveWindowEdge,
  viewDomainFor,
  windowFractions,
} from '../domain/zoomDomain.js'
import { derivativeKindFor, isMetricForSport, metricOrder, metricRegistry } from '../metrics/metricRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { useStatsBasis } from '../stats/StatsBasisContext.jsx'
import { ChartToolbar } from './ChartToolbar.jsx'
import { Y_AXIS_RIGHT_WIDTH } from './chartGeometry.js'
import { MapPanel } from './MapPanel.jsx'
import { MetricPanel } from './MetricPanel.jsx'
import { useIsNarrow } from './useIsNarrow.js'
import { useEdgeDrag } from './useEdgeDrag.js'
import { useTouchHoverHandoff } from './useTouchHoverHandoff.js'
import { useWheelPan } from './useWheelPan.js'
import { useTouchScrub } from './useTouchScrub.js'

const FIRST_PANEL_HEIGHT = 200
const OTHER_PANEL_HEIGHT = 140
// §9's "panel heights reduced ~25% below 720px". It can't be a media query:
// these are JS numbers handed to <ResponsiveContainer height>.
const NARROW_FIRST_PANEL_HEIGHT = 150
const NARROW_OTHER_PANEL_HEIGHT = 105

// The map's drawing area. Taller than the first chart panel because a route is
// two-dimensional — a 140px-tall map of a city loop is a scribble — and the
// metric heights above are deliberately UNCHANGED by its presence: the map
// takes its space from the page, not from the charts.
const MAP_PANEL_HEIGHT = 240
const NARROW_MAP_PANEL_HEIGHT = 180

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
  const {
    xMode,
    zoomDomain,
    viewDomain,
    enabledMetrics,
    enabledStats,
    showMap,
    basemap,
    setZoom,
    setBasemap,
    toggleStat,
  } = useChartView()
  const isNarrow = useIsNarrow()

  // Both the extent the gesture solves against and the window the chips report
  // come from StatsBasisContext, above this component — the header reports the
  // same window (its elapsed duration), and one basis is what keeps the two
  // from drifting. Called above the `if (!activity)` guard below, since a hook
  // is a hook wherever its value comes from.
  const { fullExtent, basis: statsBasis } = useStatsBasis()

  // Hoisted ABOVE the `if (!activity)` guard, with `activity?.`, because the
  // gutter width below feeds the gesture hooks and a hook cannot be called
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

  // ONE derivation of where the window's edges sit across the plot, for the
  // whole stack: every panel's overlay draws its handles from these, and the
  // pan re-expresses its travel against them. Two derivations would be free to
  // disagree, and the symptom would be a handle that does not sit where
  // dragging it thinks it does.
  const fractions = windowFractions(zoomDomain, viewDomain, fullExtent)

  const { ref: wheelPanRef } = useWheelPan({
    // THE WINDOW, still: the pan's arithmetic is all about the window, and
    // `windowFractions` is the one thing it needs to know about the wider range
    // now being plotted around it.
    domain: zoomDomain,
    windowFractions: fractions,
    fullExtent,
    onZoomChange: (next) => setZoom(next, viewDomainFor(next, fullExtent)),
    rightInset,
  })
  const handoffRef = useTouchHoverHandoff()
  const scrubRef = useTouchScrub({ rightInset })

  // Dragging a window edge — the only way to zoom. The view is deliberately NOT
  // re-fitted per frame: the hook hands back the view the drag is using, which
  // is the frozen one while the pointer is inside the plot, because a view that
  // tracked the window live would run away under the pointer. The one exception
  // is a pointer held at the plot edge, where the hook grows that view itself
  // and the window with it. Both arguments are in useEdgeDrag.js's header. It
  // re-fits symmetrically exactly once, on release.
  const { ref: edgeDragRef, onEdgePointerDown } = useEdgeDrag({
    zoomDomain,
    viewDomain,
    fullExtent,
    rightInset,
    onWindowChange: (next, view) => setZoom(next, view),
    onWindowCommit: (next) => setZoom(next, viewDomainFor(next, fullExtent)),
  })

  // The keyboard route into the same edit. It solves against the FULL EXTENT
  // rather than the view — a discrete press is not tracking a pointer, so
  // nothing constrains it to what is currently on screen, and Home/End would
  // otherwise stop at the shoulder instead of at the activity's own end.
  const onEdgeKeyMove = useCallback(
    (edge, value) => {
      if (!fullExtent) return
      const next = moveWindowEdge(zoomDomain, edge, value, fullDomain(), fullExtent, {
        minSpan: minSpanFor(fullExtent[1] - fullExtent[0]),
      })
      setZoom(next, viewDomainFor(next, fullExtent))
    },
    [zoomDomain, fullExtent, setZoom],
  )

  // Four callback refs, one node. All four return a React 19 cleanup, so all
  // four have to be collected and all four have to run — dropping any leaks its
  // listeners on every remount. All are useCallback(…, []), so this stays stable
  // too and the listeners are never torn down mid-gesture. Their ORDER does not
  // matter, even though two of them call stopPropagation(): stopPropagation
  // never affects other listeners on the same target, which is already why the
  // scrub guard and the handoff coexist here.
  const stackRef = useCallback(
    (node) => {
      const cleanups = [wheelPanRef(node), handoffRef(node), scrubRef(node), edgeDragRef(node)]
      return () => {
        for (const cleanup of cleanups) cleanup?.()
      }
    },
    [wheelPanRef, handoffRef, scrubRef, edgeDragRef],
  )

  if (!activity) return null

  return (
    <div
      className="chart-stack"
      ref={stackRef}
      // THE ONLY IN-PRODUCT DOCUMENTATION OF THE ZOOM, now that there is no
      // hint line and no gesture to guess at, so it has to name the handles AND
      // the hold-at-the-edge expansion — that is the half nobody discovers by
      // trying. Costs nothing in a screenshot, unlike a permanent hint line.
      // role="group" is what makes the aria-label reachable at all: a bare div
      // is `generic`, and an accessible name on a generic element is dropped.
      role="group"
      title="Drag the window edges to zoom — hold one at the edge of the plot to keep widening. While zoomed, scroll sideways to pan. Swipe one finger sideways to move the crosshair"
      aria-label="Activity charts. Drag the window edges to zoom the time axis, trimming the start or end of the activity; the faded shoulders show what is outside the window. Hold an edge against the edge of the plot to keep widening the window back out. While zoomed, scroll sideways to pan. Swipe one finger sideways to move the crosshair, which follows the swipe rather than jumping to the finger."
    >
      {/* Inside the stack so it shares the stack's touch-action and its
          positioning context. The position slot it used to hold moved to the app
          header, so reachability from a panel's readout bridge no longer keeps
          it here. */}
      <ChartToolbar />
      {/* FIRST in the stack, above every chart: the route is the frame the
          numbers below are read inside, and it is also the one panel with no
          x-axis of its own to align to the ticks at the bottom.
          `activity.track != null` is the whole availability rule — see
          domain/normalizeActivity.js for why this is not an availableMetrics
          entry. The metric panel heights below are untouched by its presence. */}
      {activity.track != null && showMap && (
        <MapPanel
          activity={activity}
          xMode={xMode}
          zoomDomain={zoomDomain}
          // The SAME extent the edge drag solves against, from one basis above
          // this component, so the bright window and the charts cannot disagree
          // about where the edges of the zoom are.
          fullExtent={fullExtent}
          rightInset={rightInset}
          height={isNarrow ? NARROW_MAP_PANEL_HEIGHT : MAP_PANEL_HEIGHT}
          basemap={basemap}
          onBasemapChange={setBasemap}
        />
      )}
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
            viewDomain={viewDomain}
            windowFractions={fractions}
            fullExtent={fullExtent}
            onEdgePointerDown={onEdgePointerDown}
            onEdgeKeyMove={onEdgeKeyMove}
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
            // The same rule, named rather than inferred from the slot above
            // being non-null — the slot is legitimately null in the app's own
            // tests, and the map's marker must still be driven there. See
            // CrosshairReadout's `primary` prop.
            primary={i === 0}
          />
        )
      })}
      {/* An explicit way back, kept even though holding an edge at the plot edge
          also unwinds a 50× zoom: that takes ~4s and this is instant. Rendered
          only while zoomed, which keeps it out of an idle screenshot, and
          absolutely positioned over the plot rather than added to the toolbar
          row above: it acts on what the user is looking at, and a conditional
          control in that always-present row would change its height and reflow
          every chart below it on the first zoom. */}
      {!isFullDomain(zoomDomain) && (
        <button type="button" className="zoom-reset" onClick={() => setZoom(fullDomain(), fullDomain())}>
          Reset zoom
        </button>
      )}
    </div>
  )
}
