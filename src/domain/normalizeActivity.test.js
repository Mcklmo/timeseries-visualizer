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
    // 1 Hz sampling with a 30s gap: past detectPauses' threshold at this
    // cadence (gapThresholdFor(1) === 10), so the sample after it is marked
    // not-moving. Sampled at 1 Hz deliberately — the threshold scales with the
    // recording's own interval now, and a 30s gap in a 10s-cadence log is
    // ordinary jitter rather than a pause (see the sparse test below).
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:01.000Z'), distanceMeters: 3, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:02.000Z'), distanceMeters: 6, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:32.000Z'), distanceMeters: 6, speedMps: 3 }), // 30s gap
      tp({ time: new Date('2026-01-01T00:00:33.000Z'), distanceMeters: 9, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })
    expect(activity.totalTime).toBe(33)
    // moving time should be less than total time since a gap was paused through
    expect(activity.totalMovingTime).toBeLessThan(activity.totalTime)
  })

  it('exposes the recording\'s median sampling interval for the sampling-adaptive thresholds', () => {
    const trackpoints = [0, 600, 1200, 1800].map((s) =>
      tp({ time: new Date(Date.UTC(2026, 0, 1, 0, 0, s)), lat: 47 + s / 100000, lon: 8 }),
    )
    const activity = normalizeActivity({ id: 'a1', sport: 'track', trackpoints })
    expect(activity.samplingIntervalS).toBe(600)
  })

  it('keeps sparse breadcrumbs moving — the regression that made a 100km satellite track average 0:02 min/km', () => {
    // A SPOT-style log: a position every 10 minutes for two hours. Every
    // sample past the first used to trip detectPauses' fixed 10s gap
    // threshold, collapsing totalMovingTime to the first interval.
    const trackpoints = Array.from({ length: 12 }, (_, i) =>
      tp({ time: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 600)), lat: 47 + i * 0.01, lon: 8, altitudeMeters: 400 + i }),
    )
    const activity = normalizeActivity({ id: 'a1', sport: 'track', trackpoints })

    expect(activity.samples.every((s) => s.moving)).toBe(true)
    expect(activity.totalMovingTime).toBe(activity.totalTime)
    // ~1.1 km per 0.01° of latitude every 10 min -> a plausible ~6.7 km/h
    const avgSpeedMps = activity.totalDistance / activity.totalMovingTime
    expect(avgSpeedMps).toBeGreaterThan(1)
    expect(avgSpeedMps).toBeLessThan(3)
  })

  it('still marks a real multi-hour dropout in a sparse recording as paused', () => {
    const times = [0, 600, 1200, 1800, 23400, 24000] // 6-hour satellite outage mid-log
    const trackpoints = times.map((s, i) =>
      tp({ time: new Date(Date.UTC(2026, 0, 1, 0, 0, s)), lat: 47 + i * 0.01, lon: 8 }),
    )
    const activity = normalizeActivity({ id: 'a1', sport: 'track', trackpoints })

    expect(activity.samples.map((s) => s.moving)).toEqual([true, true, true, true, false, true])
    expect(activity.totalMovingTime).toBeLessThan(activity.totalTime)
  })

  it('derives availableMetrics from which fields actually have data', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3, heartRateBpm: 120 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3, heartRateBpm: 125 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'running', trackpoints })
    expect(activity.availableMetrics).toEqual(['pace', 'speed', 'heartRate'])
  })

  it('flags both pace and speed as available whenever speed data exists, regardless of sport', () => {
    // availableMetrics stays sport-agnostic by design — sport-based
    // visibility (pace for running, speed for cycling) is a UI-layer concern.
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ id: 'a1', sport: 'cycling', trackpoints })
    expect(activity.availableMetrics).toEqual(['pace', 'speed'])
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

  it('derives a name from sport and the computed startTime when no sportLabel is given', () => {
    const activity = normalizeActivity({
      id: 'a1',
      sport: 'running',
      trackpoints: [tp({ time: new Date(2026, 0, 1, 6), distanceMeters: 0, speedMps: 3 })],
    })
    expect(activity.name).toMatch(/Run$/)
  })

  it('uses sportLabel in the derived name when given', () => {
    const activity = normalizeActivity({
      id: 'a1',
      sport: 'cycling',
      sportLabel: 'Gravel Ride',
      trackpoints: [tp({ time: new Date(2026, 0, 1, 6), distanceMeters: 0, speedMps: 3 })],
    })
    expect(activity.name).toMatch(/Gravel Ride$/)
  })
})
