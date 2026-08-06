// Controls what the chart stack shows: x-axis mode, zoom domain, which
// metrics are on, and which stat lines are on per metric. See ARCHITECTURE.md
// §10. Stats themselves (§6) are computed over the whole activity regardless
// of zoomDomain — this context only tracks which lines are *visible*.
import { createContext, useCallback, useContext, useState } from 'react'
import { metricOrder } from '../metrics/metricRegistry.js'

const ChartViewContext = createContext(undefined)

function initialState() {
  return {
    xMode: 'time',
    zoomDomain: ['dataMin', 'dataMax'],
    enabledMetrics: [...metricOrder],
    enabledStats: Object.fromEntries(metricOrder.map((id) => [id, ['avg']])),
    hoverIndex: null,
  }
}

export function ChartViewProvider({ children }) {
  const [state, setState] = useState(initialState)

  const setXMode = useCallback((xMode) => setState((s) => ({ ...s, xMode })), [])
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
