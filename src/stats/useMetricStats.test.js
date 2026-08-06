import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMetricStats } from './useMetricStats.js'

const activity = {
  totalMovingTime: 200,
  totalDistance: 700,
  samples: [
    { t: 0, d: 0, speed: 5, heartRate: 140, moving: true },
    { t: 100, d: 500, speed: 2, heartRate: 160, moving: true },
    { t: 200, d: 700, speed: 2, heartRate: 160, moving: true },
  ],
}

describe('useMetricStats', () => {
  it('returns null stats when there is no activity yet', () => {
    const { result } = renderHook(() => useMetricStats(null, 'pace'))
    expect(result.current).toEqual({ max: null, avg: null, median: null })
  })

  it('computes max/avg/median for the requested metric via stats/aggregate.js', () => {
    const { result } = renderHook(() => useMetricStats(activity, 'pace'))
    // avg must be the weighted-pace formula (same case as aggregate.test.js): 285.71 s/km
    expect(result.current.avg).toBeCloseTo(285.714, 2)
    // max pace = fastest instantaneous moment = smallest s/km = 200
    expect(result.current.max).toBeCloseTo(200, 6)
  })

  it('computes heart rate stats independently of pace', () => {
    const { result } = renderHook(() => useMetricStats(activity, 'heartRate'))
    expect(result.current.max).toBe(160)
  })

  it('memoizes: same activity + metricId across re-renders returns the same object', () => {
    const { result, rerender } = renderHook(({ metricId }) => useMetricStats(activity, metricId), {
      initialProps: { metricId: 'pace' },
    })
    const first = result.current
    rerender({ metricId: 'pace' })
    expect(result.current).toBe(first)
  })

  it('recomputes when the metricId changes', () => {
    const { result, rerender } = renderHook(({ metricId }) => useMetricStats(activity, metricId), {
      initialProps: { metricId: 'pace' },
    })
    const paceStats = result.current
    rerender({ metricId: 'heartRate' })
    expect(result.current).not.toBe(paceStats)
    expect(result.current.max).toBe(160)
  })
})
