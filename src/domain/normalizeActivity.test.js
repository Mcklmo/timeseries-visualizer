import { describe, it, expect } from 'vitest'
import { normalizeActivity } from './normalizeActivity.js'

function tp(overrides) {
  return { time: new Date('2026-01-01T00:00:00.000Z'), ...overrides }
}

describe('normalizeActivity', () => {
  it('builds t (seconds since start) and preserves field mapping into samples', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, heartRateBpm: 120, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, heartRateBpm: 125, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })

    expect(activity.samples).toHaveLength(2)
    expect(activity.samples[0].t).toBe(0)
    expect(activity.samples[1].t).toBe(10)
    expect(activity.samples[1].d).toBe(30)
    expect(activity.samples[1].heartRate).toBe(125)
    expect(activity.startTime).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('drops trackpoints that carry only a timestamp and nothing else', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:05.000Z') }), // time only — should be dropped
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })
    expect(activity.samples).toHaveLength(2)
    expect(activity.samples.map((s) => s.t)).toEqual([0, 10])
  })

  it('computes totalTime/totalDistance from the last sample', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:20.000Z'), distanceMeters: 60, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })
    expect(activity.totalTime).toBe(20)
    expect(activity.totalDistance).toBe(60)
  })

  it('excludes paused stretches from totalMovingTime but keeps totalTime including them', () => {
    // 20s gap between samples 1 and 2 -> sample 2 marked not-moving by detectPauses
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:40.000Z'), distanceMeters: 30, speedMps: 3 }), // 30s gap after resume
      tp({ time: new Date('2026-01-01T00:00:50.000Z'), distanceMeters: 60, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })
    expect(activity.totalTime).toBe(50)
    // moving time should be less than total time since a gap was paused through
    expect(activity.totalMovingTime).toBeLessThan(activity.totalTime)
  })

  it('derives availableMetrics from which fields actually have data', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3, heartRateBpm: 120 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3, heartRateBpm: 125 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })
    expect(activity.availableMetrics).toEqual(['pace', 'heartRate'])
  })

  it('omits a metric entirely when no trackpoint has it (e.g. no power meter)', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3, cadenceSpm: 170 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3, cadenceSpm: 172 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })
    expect(activity.availableMetrics).not.toContain('power')
  })

  it('handles an empty trackpoint list without throwing', () => {
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints: [] })
    expect(activity.samples).toEqual([])
    expect(activity.totalTime).toBe(0)
    expect(activity.totalDistance).toBe(0)
    expect(activity.availableMetrics).toEqual([])
  })

  it('passes id and sport through unchanged', () => {
    const activity = normalizeActivity({
      id: 'garmin-123',
      sport: 'running',
      trackpoints: [tp({ distanceMeters: 0, speedMps: 3 })],
    })
    expect(activity.id).toBe('garmin-123')
    expect(activity.sport).toBe('running')
  })
})
