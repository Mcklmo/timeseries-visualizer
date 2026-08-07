import { useMemo } from 'react'
import { gapThresholdFor } from '../domain/samplingInterval.js'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { computeMetricStat } from './aggregate.js'

const EMPTY = { max: null, min: null, avg: null, median: null }

/**
 * Memoized max/min/avg/median for one metric, over the WHOLE activity — never
 * the zoom window (ARCHITECTURE.md §6: drifting reference lines are
 * disorienting). Recomputes only when the activity or metricId changes, so
 * hover/zoom interactions never retrigger aggregation.
 * @param {import('../domain/types.js').Activity|null} activity
 * @param {import('../domain/types.js').MetricId} metricId
 */
export function useMetricStats(activity, metricId) {
  return useMemo(() => {
    if (!activity) return EMPTY
    const metric = metricRegistry[metricId]
    const base = {
      samples: activity.samples,
      metric,
      totalMovingTime: activity.totalMovingTime,
      totalDistance: activity.totalDistance,
      // Guarded, not defensive styling: gapThresholdFor(undefined) is 10, not
      // Infinity, so an activity with no measured cadence would have every
      // interval read as a gap and every weight zeroed.
      gapThresholdS:
        activity.samplingIntervalS != null ? gapThresholdFor(activity.samplingIntervalS) : undefined,
    }
    return {
      max: computeMetricStat({ ...base, statKind: 'max' }),
      min: computeMetricStat({ ...base, statKind: 'min' }),
      avg: computeMetricStat({ ...base, statKind: 'avg' }),
      median: computeMetricStat({ ...base, statKind: 'median' }),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, metricId])
}
