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
import { metricOrder } from '../metrics/metricRegistry.js'
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
    zoomDomain: fullDomain(),
    enabledMetrics: prefs?.enabledMetrics ?? [...metricOrder],
    // Every stat off until asked for: a freshly opened activity should show
    // the athlete's own data, not four reference lines and a chip row nobody
    // requested. enabledMetrics keeps its all-on default — a panel that isn't
    // drawn is a metric you can't see at all, which is a different question.
    enabledStats: prefs?.enabledStats ?? Object.fromEntries(metricOrder.map((id) => [id, []])),
    hoverIndex: null,
  }
}

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
    })
  }, [activityKey, state.xMode, state.enabledMetrics, state.enabledStats])

  // A numeric zoomDomain is meaningless across modes (seconds vs metres), so
  // switching axes resets zoom rather than silently misreading stale bounds.
  const setXMode = useCallback(
    (xMode) => setState((s) => ({ ...s, xMode, zoomDomain: fullDomain() })),
    [],
  )
  const setZoomDomain = useCallback((zoomDomain) => setState((s) => ({ ...s, zoomDomain })), [])
  const setHoverIndex = useCallback((hoverIndex) => setState((s) => ({ ...s, hoverIndex })), [])

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
        const next = current.includes(statKind)
          ? current.filter((k) => k !== statKind)
          : [...current, statKind]
        return { ...s, enabledStats: { ...s.enabledStats, [metricId]: next } }
      }),
    [],
  )

  const value = {
    ...state,
    setXMode,
    setZoomDomain,
    setHoverIndex,
    toggleMetric,
    toggleStat,
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
