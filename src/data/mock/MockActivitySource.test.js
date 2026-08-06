import { describe, it, expect } from 'vitest'
import { MockActivitySource } from './MockActivitySource.js'

describe('MockActivitySource', () => {
  it('declares kind "mock"', () => {
    expect(new MockActivitySource().kind).toBe('mock')
  })

  it('resolves an Activity shaped per domain/types.js regardless of the ref passed', () => {
    return new MockActivitySource().load({ type: 'id', id: 'anything' }).then((activity) => {
      expect(activity.id).toBeTruthy()
      expect(activity.sport).toBe('running')
      expect(activity.startTime).toBeInstanceOf(Date)
      expect(activity.totalTime).toBeGreaterThan(0)
      expect(activity.totalMovingTime).toBeGreaterThan(0)
      expect(activity.totalDistance).toBeGreaterThan(0)
      expect(Array.isArray(activity.samples)).toBe(true)
      expect(activity.samples.length).toBeGreaterThan(0)
      expect(Array.isArray(activity.availableMetrics)).toBe(true)
    })
  })

  it('includes a moving:false stretch (a pause), so pause-handling UI has something to render', async () => {
    const activity = await new MockActivitySource().load()
    expect(activity.samples.some((s) => s.moving === false)).toBe(true)
    expect(activity.totalMovingTime).toBeLessThan(activity.totalTime)
  })

  it('omits power from availableMetrics (realistic: many devices do not report running power)', async () => {
    const activity = await new MockActivitySource().load()
    expect(activity.availableMetrics).not.toContain('power')
    expect(activity.availableMetrics).toEqual(
      expect.arrayContaining(['pace', 'heartRate', 'cadence', 'altitude']),
    )
  })

  it('totalDistance matches the last sample\'s cumulative distance', async () => {
    const activity = await new MockActivitySource().load()
    const last = activity.samples[activity.samples.length - 1]
    expect(activity.totalDistance).toBeCloseTo(last.d, 1)
  })
})
