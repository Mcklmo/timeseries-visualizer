import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMetricStats } from './useMetricStats.js'

// A basis, not an activity: the hook takes whatever stats/statsBasis.js hands
// it (whole activity while unzoomed, the window once zoomed) and has no notion
// of zoom itself. Built literally here so this file tests the hook rather than
// the slicing, which statsBasis.test.js owns.
const basis = {
  totalMovingTime: 200,
  totalDistance: 700,
  gapThresholdS: undefined,
  samples: [
    { t: 0, d: 0, speed: 5, heartRate: 140, moving: true },
    { t: 100, d: 500, speed: 2, heartRate: 160, moving: true },
    { t: 200, d: 700, speed: 2, heartRate: 160, moving: true },
  ],
}

describe('useMetricStats', () => {
  it('returns null stats when there is no basis yet (no activity loaded)', () => {
    const { result } = renderHook(() => useMetricStats(null, 'pace'))
    expect(result.current).toEqual({ max: null, min: null, avg: null, median: null })
  })

  it('computes max/min/avg/median for the requested metric via stats/aggregate.js', () => {
    const { result } = renderHook(() => useMetricStats(basis, 'pace'))
    // avg must be the weighted-pace formula (same case as aggregate.test.js): 285.71 s/km
    expect(result.current.avg).toBeCloseTo(285.714, 2)
    // max pace = fastest instantaneous moment = smallest s/km = 200
    expect(result.current.max).toBeCloseTo(200, 6)
    // min pace = slowest instantaneous moment = largest s/km = 500 (invertAxis-aware, mirrors max)
    expect(result.current.min).toBeCloseTo(500, 6)
  })

  it('computes heart rate stats independently of pace', () => {
    const { result } = renderHook(() => useMetricStats(basis, 'heartRate'))
    expect(result.current.max).toBe(160)
    expect(result.current.min).toBe(140)
  })

  it('memoizes: same basis + metricId across re-renders returns the same object', () => {
    const { result, rerender } = renderHook(({ metricId }) => useMetricStats(basis, metricId), {
      initialProps: { metricId: 'pace' },
    })
    const first = result.current
    rerender({ metricId: 'pace' })
    expect(result.current).toBe(first)
  })

  it('recomputes when the metricId changes', () => {
    const { result, rerender } = renderHook(({ metricId }) => useMetricStats(basis, metricId), {
      initialProps: { metricId: 'pace' },
    })
    const paceStats = result.current
    rerender({ metricId: 'heartRate' })
    expect(result.current).not.toBe(paceStats)
    expect(result.current.max).toBe(160)
  })

  // The whole point of the basis being an argument: a new one (which is what a
  // zoom change produces) must re-aggregate, including the pace totals that
  // don't come from the samples at all.
  it('recomputes when the basis changes, totals included', () => {
    const windowed = {
      totalMovingTime: 100,
      totalDistance: 200,
      gapThresholdS: undefined,
      samples: basis.samples.slice(1),
    }
    const { result, rerender } = renderHook(({ b }) => useMetricStats(b, 'pace'), {
      initialProps: { b: basis },
    })
    expect(result.current.avg).toBeCloseTo(285.714, 2)

    rerender({ b: windowed })
    expect(result.current.avg).toBeCloseTo(500, 6) // 100 s / 200 m
    expect(result.current.min).toBeCloseTo(500, 6) // the 5 m/s sample is outside the window
  })
})
