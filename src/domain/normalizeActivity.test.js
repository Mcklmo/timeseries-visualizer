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
    const activity = normalizeActivity({ sport: 'running', trackpoints })

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
    const activity = normalizeActivity({ sport: 'running', trackpoints })
    expect(activity.samples).toHaveLength(2)
    expect(activity.samples.map((s) => s.t)).toEqual([0, 10])
  })

  it('computes totalTime/totalDistance from the last sample', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:20.000Z'), distanceMeters: 60, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ sport: 'running', trackpoints })
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
    const activity = normalizeActivity({ sport: 'running', trackpoints })
    expect(activity.totalTime).toBe(33)
    // Exactly 3 of the 4 intervals count: 0->1 and 1->2 are ordinary travel,
    // 2->32 is the 30s recording gap and scores 0, and 32->33 is the boundary
    // out of the pause (only its left end is stopped), so it counts. Asserted
    // exactly rather than as `< totalTime` — the weak inequality passed while
    // this returned 32 of 33s, which is how the defect survived.
    expect(activity.totalMovingTime).toBe(3)
  })

  it('excludes a sustained near-zero-speed stretch from totalMovingTime', () => {
    // detectPauses' other trigger: the device kept recording, but speed sat
    // under 0.3 m/s for longer than the threshold. Unlike a gap this marks the
    // whole stopped run, so the interior intervals are stopped at both ends.
    // 1 Hz sampling -> gapThresholdFor(1) === 10.
    const speedAt = (i) => (i >= 10 && i <= 25 ? 0.1 : 3)
    const trackpoints = Array.from({ length: 31 }, (_, i) =>
      tp({
        time: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        distanceMeters: i * 3,
        speedMps: speedAt(i),
      }),
    )
    const activity = normalizeActivity({ sport: 'running', trackpoints })

    expect(activity.samples.slice(10, 26).every((s) => s.moving === false)).toBe(true)
    expect(activity.totalTime).toBe(30)
    // 30 one-second intervals, less the 15 whose both ends fall inside the
    // stopped run (10->11 … 24->25). The two boundary intervals, 9->10 into
    // the stop and 25->26 out of it, still count.
    expect(activity.totalMovingTime).toBe(15)
  })

  it('exposes the recording\'s median sampling interval for the sampling-adaptive thresholds', () => {
    const trackpoints = [0, 600, 1200, 1800].map((s) =>
      tp({ time: new Date(Date.UTC(2026, 0, 1, 0, 0, s)), lat: 47 + s / 100000, lon: 8 }),
    )
    const activity = normalizeActivity({ sport: 'track', trackpoints })
    expect(activity.samplingIntervalS).toBe(600)
  })

  it('keeps sparse breadcrumbs moving — the regression that made a 100km satellite track average 0:02 min/km', () => {
    // A SPOT-style log: a position every 10 minutes for two hours. Every
    // sample past the first used to trip detectPauses' fixed 10s gap
    // threshold, collapsing totalMovingTime to the first interval.
    const trackpoints = Array.from({ length: 12 }, (_, i) =>
      tp({ time: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 600)), lat: 47 + i * 0.01, lon: 8, altitudeMeters: 400 + i }),
    )
    const activity = normalizeActivity({ sport: 'track', trackpoints })

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
    const activity = normalizeActivity({ sport: 'track', trackpoints })

    expect(activity.samples.map((s) => s.moving)).toEqual([true, true, true, true, false, true])
    // Four of the five intervals are ordinary 600s breadcrumbs; the 6-hour
    // outage scores 0. 4 x 600 = 2400 of the 24000s elapsed.
    expect(activity.totalMovingTime).toBe(2400)
  })

  it('derives availableMetrics from which fields actually have data', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3, heartRateBpm: 120 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3, heartRateBpm: 125 }),
    ]
    const activity = normalizeActivity({ sport: 'running', trackpoints })
    expect(activity.availableMetrics).toEqual(['pace', 'speed', 'heartRate'])
  })

  it('flags both pace and speed as available whenever speed data exists, regardless of sport', () => {
    // availableMetrics stays sport-agnostic by design — sport-based
    // visibility (pace for running, speed for cycling) is a UI-layer concern.
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3 }),
    ]
    const activity = normalizeActivity({ sport: 'cycling', trackpoints })
    expect(activity.availableMetrics).toEqual(['pace', 'speed'])
  })

  it('omits a metric entirely when no trackpoint has it (e.g. no power meter)', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3, cadenceSpm: 170 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3, cadenceSpm: 172 }),
    ]
    const activity = normalizeActivity({ sport: 'running', trackpoints })
    expect(activity.availableMetrics).not.toContain('power')
  })

  it('handles an empty trackpoint list without throwing', () => {
    const activity = normalizeActivity({ sport: 'running', trackpoints: [] })
    expect(activity.samples).toEqual([])
    expect(activity.totalTime).toBe(0)
    expect(activity.totalDistance).toBe(0)
    expect(activity.availableMetrics).toEqual([])
  })

  it('passes sport through unchanged', () => {
    const activity = normalizeActivity({ sport: 'running', trackpoints: [tp({ distanceMeters: 0, speedMps: 3 })] })
    expect(activity.sport).toBe('running')
  })

  // No adapter supplies an id any more: it is a fingerprint of the normalized
  // content, computed here (domain/activityKey.js). The property that matters
  // is that reopening the same file lands on the same id, since that is what
  // the remembered chart view is keyed by.
  it('derives a stable id from the content: same trackpoints in, same id out', () => {
    const trackpoints = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3 }),
    ]
    const first = normalizeActivity({ sport: 'running', trackpoints })
    const second = normalizeActivity({ sport: 'running', trackpoints: trackpoints.map((p) => ({ ...p })) })

    expect(first.id).toBe(second.id)
    expect(first.id).toMatch(/^running-/)
  })

  it('gives a different id to a different recording', () => {
    const base = [
      tp({ time: new Date('2026-01-01T00:00:00.000Z'), distanceMeters: 0, speedMps: 3 }),
      tp({ time: new Date('2026-01-01T00:00:10.000Z'), distanceMeters: 30, speedMps: 3 }),
    ]
    const shifted = base.map((p) => ({ ...p, time: new Date(p.time.getTime() + 1000) }))

    expect(normalizeActivity({ sport: 'running', trackpoints: shifted }).id).not.toBe(
      normalizeActivity({ sport: 'running', trackpoints: base }).id,
    )
    expect(normalizeActivity({ sport: 'running', trackpoints: base.slice(0, 1) }).id).not.toBe(
      normalizeActivity({ sport: 'running', trackpoints: base }).id,
    )
  })

  it('derives a name from sport and the computed startTime when no sportLabel is given', () => {
    const activity = normalizeActivity({
      sport: 'running',
      trackpoints: [tp({ time: new Date(2026, 0, 1, 6), distanceMeters: 0, speedMps: 3 })],
    })
    expect(activity.name).toMatch(/Run$/)
  })

  it('uses sportLabel in the derived name when given', () => {
    const activity = normalizeActivity({
      sport: 'cycling',
      sportLabel: 'Gravel Ride',
      trackpoints: [tp({ time: new Date(2026, 0, 1, 6), distanceMeters: 0, speedMps: 3 })],
    })
    expect(activity.name).toMatch(/Gravel Ride$/)
  })
})
