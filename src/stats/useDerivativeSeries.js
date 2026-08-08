import { useMemo } from 'react'
import { derivativeSeries } from '../domain/derivative.js'
import { gapThresholdFor } from '../domain/samplingInterval.js'
import { metricRegistry } from '../metrics/metricRegistry.js'

/** 'd1'/'d2' are the persisted, user-facing kind names; the domain function
 *  takes a numeric order. One map, here, rather than parsing the string. */
const ORDER_OF = { d1: 1, d2: 2 }

/**
 * The metric's derivative series, or null when no overlay is switched on.
 *
 * THE EARLY NULL IS THE WHOLE OF THE LAZINESS. Nothing is differentiated,
 * accessed or allocated until a checkbox is ticked, so the cost of this feature
 * on a panel nobody has enabled it for is one `useMemo` returning null. That is
 * why no worker, idle callback or chunking appears anywhere in this feature:
 * over the ~10k samples ARCHITECTURE §7 treats as the ceiling, the computed
 * path is one centred-difference pass plus one rolling mean — strictly less
 * work than the median sort `useMetricStats` already runs on every settled zoom
 * for every visible panel, checked or not.
 *
 * Runs over FULL-RESOLUTION `activity.samples`, never the zoom slice, matching
 * the chart rows themselves (MetricPanel builds those unsliced too). A
 * slice-local derivative would change its own values as you pinch, because the
 * smoothing window that straddles the window edge would lose the samples
 * outside it — the line would visibly rewrite itself at the edges on every
 * gesture.
 *
 * @param {import('../domain/types.js').Activity} activity
 * @param {import('../domain/types.js').MetricId} metricId
 * @param {'d1'|'d2'|null} kind
 * @returns {(number|null)[]|null} value-units per second; null when off. The
 *   display scaling to the registry's units is MetricPanel's job.
 */
export function useDerivativeSeries(activity, metricId, kind) {
  const { samples, samplingIntervalS } = activity

  return useMemo(() => {
    const order = kind == null ? null : ORDER_OF[kind]
    const metric = metricRegistry[metricId]
    // `metric.derivative` is checked as well as `kind`: a stored pref for a
    // metric that has since lost its derivative spec would otherwise compute a
    // series with no unit or format to render it with.
    if (!order || !metric?.derivative) return null

    return derivativeSeries(
      samples.map((s) => metric.accessor(s)),
      samples.map((s) => s.t),
      { order, intervalS: samplingIntervalS, gapThresholdS: gapThresholdFor(samplingIntervalS) },
    )
  }, [samples, samplingIntervalS, metricId, kind])
}
