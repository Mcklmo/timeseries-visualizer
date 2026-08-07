import { useMemo } from 'react'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { computeMetricStat } from './aggregate.js'

const EMPTY = { max: null, min: null, avg: null, median: null }

/**
 * Memoized max/min/avg/median for one metric, over whatever the basis covers —
 * the whole activity while unzoomed, the visible window once zoomed
 * (ARCHITECTURE.md §6). The hook deliberately knows nothing about zoom: it
 * recomputes exactly when the basis identity or the metricId changes, and
 * stats/statsBasis.js is what decides when that is. Building the basis
 * upstream, once per stack rather than once per panel, is also what keeps a
 * pinch from slicing the sample array six times a frame.
 *
 * @param {import('./statsBasis.js').StatsBasis|null} basis
 * @param {import('../domain/types.js').MetricId} metricId
 */
export function useMetricStats(basis, metricId) {
  return useMemo(() => {
    if (!basis) return EMPTY
    const base = { ...basis, metric: metricRegistry[metricId] }
    return {
      max: computeMetricStat({ ...base, statKind: 'max' }),
      min: computeMetricStat({ ...base, statKind: 'min' }),
      avg: computeMetricStat({ ...base, statKind: 'avg' }),
      median: computeMetricStat({ ...base, statKind: 'median' }),
    }
  }, [basis, metricId])
}
