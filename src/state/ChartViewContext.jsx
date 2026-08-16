// Controls what the chart stack shows: x-axis mode, zoom domain, which
// metrics are on, and which stat lines are on per metric. See ARCHITECTURE.md
// §10. This context tracks which stat lines are *visible*; what they are
// computed over follows zoomDomain, and that derivation lives entirely in
// stats/statsBasis.js — there is no stats-specific state here (§6).
//
// TWO CONSEQUENCES OF REMEMBERING THE VIEW PER ACTIVITY (state/viewPrefsStore.js):
//
//  1. This provider now depends on ActivityContext, to know *which* activity's
//     view it is holding. app/providers.jsx already nests it inside
//     ActivityProvider, so nothing had to be rewired — but that ordering is
//     now load-bearing rather than incidental, and swapping the two would
//     throw from useActivity().
//
//  2. Loading an activity resets the zoom. Previously a numeric zoomDomain
//     survived from one activity into the next, where "400–900 s" describes a
//     window in a different run entirely — meaningless, and nothing cleared
//     it. That is a fix, not a side effect; zoomDomain is deliberately the one
//     piece of this state that is neither persisted nor carried over.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { fullDomain } from '../domain/zoomDomain.js'
import { DEFAULT_BASEMAP } from '../map/basemapRegistry.js'
import { derivativeStatKinds, metricOrder } from '../metrics/metricRegistry.js'
import { useActivity } from './ActivityContext.jsx'
import { viewPrefsStore } from './viewPrefsStore.js'

const ChartViewContext = createContext(undefined)

/** @param {import('./viewPrefsStore.js').ViewPrefs|null} prefs - a remembered view, when this activity has one */
function initialState(prefs) {
  return {
    xMode: prefs?.xMode ?? 'time',
    // One definition of "unzoomed" (domain/zoomDomain.js), shared with
    // ChartStack, MetricPanel and the reset control, rather than this literal
    // written out in four places.
    //
    // TWO DOMAINS, ONE ZOOM. `zoomDomain` is THE WINDOW — unchanged meaning,
    // which is why nothing downstream of it (statsBasis, the header duration,
    // the map's bright segment) knows this split exists. `viewDomain` is WHAT
    // IS PLOTTED: the window plus a context margin each side, so the shoulders
    // draw faded and a zoom is legible on the chart itself. They are written
    // together by setZoom below and are never persisted or carried over — see
    // consequence 2 in the header, which covers both.
    zoomDomain: fullDomain(),
    viewDomain: fullDomain(),
    enabledMetrics: prefs?.enabledMetrics ?? [...metricOrder],
    // Every stat off until asked for: a freshly opened activity should show
    // the athlete's own data, not four reference lines and a chip row nobody
    // requested. enabledMetrics keeps its all-on default — a panel that isn't
    // drawn is a metric you can't see at all, which is a different question.
    enabledStats: prefs?.enabledStats ?? Object.fromEntries(metricOrder.map((id) => [id, []])),
    // ⚠️ NOT AN ENTRY IN `enabledMetrics`, and it must never become one.
    // viewPrefsStore filters that array against `metricOrder`, so a 'map' id
    // surviving into it would reach `metricRegistry['map'].label` in
    // StatCheckboxes and throw a real TypeError. It is also not in
    // `availableMetrics` — see normalizeActivity.js. On by default: someone who
    // recorded a route wants to see it, and the panel simply does not render
    // when `activity.track` is null.
    showMap: prefs?.showMap ?? true,
    // A STRING, not a boolean, so satellite imagery slots in as one more id
    // without a second schema bump (map/basemapRegistry.js). Defaults to
    // 'none' — the opt-in privacy stance, pinned mechanically by App.test.jsx's
    // no-fetch assertion.
    basemap: prefs?.basemap ?? DEFAULT_BASEMAP,
  }
}

// THERE IS NO `hoverIndex` HERE, and that is a decision rather than an omission.
// It sat in this state for months as the documented seam for an external
// readout (§13 Route C) with no reader anywhere. The fixed crosshair label that
// finally needed one is built on Recharts' own hover instead — see
// ui/CrosshairReadout.jsx — because publishing the hovered index through this
// context would re-render ChartStack, and therefore every <LineChart> under it,
// on every mouse-move frame. State that looks live and is not is worse than no
// state, so it went with the feature that was supposed to use it.

export function ChartViewProvider({ children }) {
  const { activity } = useActivity()
  const activityKey = activity?.id ?? null

  const [state, setState] = useState(() => initialState(null))
  const [prefsKey, setPrefsKey] = useState(null)

  // Adjusting state during render, which React documents for exactly this
  // ("You Might Not Need an Effect" → adjusting state when a prop changes) and
  // which looks like a mistake otherwise. React re-runs this component
  // immediately, before committing anything to the DOM, so the new activity's
  // first paint already carries its own remembered view. An effect would
  // instead paint the *previous* activity's stats for one frame and then flip
  // them.
  if (activityKey !== prefsKey) {
    setPrefsKey(activityKey)
    setState(initialState(activityKey ? viewPrefsStore.read(activityKey) : null))
  }

  // The write side. Fires once more immediately after a restore, writing back
  // exactly what was just read — idempotent, and cheaper than the guard that
  // would avoid it.
  useEffect(() => {
    if (!activityKey) return
    viewPrefsStore.save(activityKey, {
      xMode: state.xMode,
      enabledMetrics: state.enabledMetrics,
      enabledStats: state.enabledStats,
      showMap: state.showMap,
      basemap: state.basemap,
    })
  }, [activityKey, state.xMode, state.enabledMetrics, state.enabledStats, state.showMap, state.basemap])

  // A numeric zoomDomain is meaningless across modes (seconds vs metres), so
  // switching axes resets zoom rather than silently misreading stale bounds.
  const setXMode = useCallback(
    (xMode) => setState((s) => ({ ...s, xMode, zoomDomain: fullDomain(), viewDomain: fullDomain() })),
    [],
  )
  // ONE setState FOR BOTH, and that is the reason this is a single setter
  // rather than two: the window must never be committed without the view it
  // sits inside. Two setters — even called back to back — would let a render
  // land between them and draw a window outside its own plotted range, which
  // is a handle off the edge of the chart.
  const setZoom = useCallback(
    (zoomDomain, viewDomain) => setState((s) => ({ ...s, zoomDomain, viewDomain })),
    [],
  )

  const toggleMetric = useCallback(
    (metricId) =>
      setState((s) => {
        const next = s.enabledMetrics.includes(metricId)
          ? s.enabledMetrics.filter((id) => id !== metricId)
          : [...s.enabledMetrics, metricId]
        // Keep canonical metricOrder regardless of toggle sequence, so
        // anything iterating enabledMetrics directly gets a stable order.
        return { ...s, enabledMetrics: metricOrder.filter((id) => next.includes(id)) }
      }),
    [],
  )

  const toggleStat = useCallback(
    (metricId, statKind) =>
      setState((s) => {
        const current = s.enabledStats[metricId] ?? []
        let next
        if (current.includes(statKind)) {
          next = current.filter((k) => k !== statKind)
        } else if (derivativeStatKinds.includes(statKind)) {
          // AT MOST ONE DERIVATIVE PER METRIC: switching d²/dt² on switches
          // d/dt off, and vice versa. The panel's right-hand axis carries one
          // unit and one gutter width, and two of them would eat ~88px of a
          // 375px phone's chrome — so the exclusion is enforced here, in the
          // one place stat state is written, rather than defended against in
          // every reader. Scalar kinds are untouched and still toggle freely.
          next = [...current.filter((k) => !derivativeStatKinds.includes(k)), statKind]
        } else {
          next = [...current, statKind]
        }
        return { ...s, enabledStats: { ...s.enabledStats, [metricId]: next } }
      }),
    [],
  )

  const toggleMap = useCallback(() => setState((s) => ({ ...s, showMap: !s.showMap })), [])

  const setBasemap = useCallback((basemap) => setState((s) => ({ ...s, basemap })), [])

  const value = {
    ...state,
    setXMode,
    setZoom,
    toggleMetric,
    toggleStat,
    toggleMap,
    setBasemap,
  }

  return <ChartViewContext.Provider value={value}>{children}</ChartViewContext.Provider>
}

export function useChartView() {
  const ctx = useContext(ChartViewContext)
  if (ctx === undefined) {
    throw new Error('useChartView must be used within a ChartViewProvider')
  }
  return ctx
}
