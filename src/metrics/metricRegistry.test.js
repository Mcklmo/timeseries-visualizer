import { describe, it, expect } from 'vitest'
import { isMetricForSport, metricRegistry, metricOrder, metricUnit } from './metricRegistry.js'
import { formatPace, formatSpeedKmh } from '../domain/units.js'

describe('metricOrder', () => {
  it('matches the display order fixed in ARCHITECTURE.md §6', () => {
    expect(metricOrder).toEqual(['pace', 'speed', 'heartRate', 'power', 'cadence', 'altitude'])
  })

  it('every id in metricOrder has a registry entry, and vice versa', () => {
    for (const id of metricOrder) expect(metricRegistry[id]).toBeDefined()
    expect(Object.keys(metricRegistry).sort()).toEqual([...metricOrder].sort())
  })
})

describe('pace', () => {
  const { pace } = metricRegistry

  it('accessor converts speed to seconds-per-km, gated on a moving threshold', () => {
    expect(pace.accessor({ speed: 1000 / 300 })).toBeCloseTo(300, 6)
    expect(pace.accessor({ speed: 0.1 })).toBeNull() // below the 0.3 m/s moving threshold
    expect(pace.accessor({})).toBeNull()
  })

  it('is the one inverted, weighted-pace, running-only metric — cycling shows speed instead', () => {
    expect(pace.invertAxis).toBe(true)
    expect(pace.aggStrategy).toBe('weightedPace')
    expect(pace.sports).toEqual(['running'])
  })

  it('format delegates to the shared formatPace formatter', () => {
    expect(pace.format(287)).toBe(formatPace(287))
  })
})

describe('speed', () => {
  const { speed } = metricRegistry

  it('accessor converts m/s to km/h, not gated on a moving threshold (0 km/h is meaningful)', () => {
    expect(speed.accessor({ speed: 10 })).toBeCloseTo(36, 6)
    expect(speed.accessor({ speed: 0 })).toBe(0)
    expect(speed.accessor({})).toBeNull()
  })

  it('is a non-inverted, moving-only, cycling-only metric', () => {
    expect(speed.invertAxis).toBe(false)
    expect(speed.aggStrategy).toBe('movingOnly')
    expect(speed.sports).toEqual(['cycling'])
  })

  it('format delegates to the shared formatSpeedKmh formatter', () => {
    expect(speed.format(28.42)).toBe(formatSpeedKmh(28.42))
  })
})

describe('heartRate', () => {
  const { heartRate } = metricRegistry
  it('accessor reads raw bpm, time-weighted, not inverted', () => {
    expect(heartRate.accessor({ heartRate: 152 })).toBe(152)
    expect(heartRate.accessor({})).toBeNull()
    expect(heartRate.aggStrategy).toBe('timeWeighted')
    expect(heartRate.invertAxis).toBeFalsy()
  })
})

describe('cadence', () => {
  const { cadence } = metricRegistry
  it('is moving-only and available for both sports, with a sport-dependent unit', () => {
    expect(cadence.accessor({ cadence: 172 })).toBe(172)
    expect(cadence.aggStrategy).toBe('movingOnly')
    expect(cadence.sports).toEqual(['running', 'cycling'])
  })

  it('unit resolves to spm for running and rpm for cycling', () => {
    expect(metricUnit(cadence, 'running')).toBe('spm')
    expect(metricUnit(cadence, 'cycling')).toBe('rpm')
  })
})

describe('power and altitude', () => {
  it('are plain time-weighted metrics available for both sports', () => {
    expect(metricRegistry.power.aggStrategy).toBe('timeWeighted')
    expect(metricRegistry.altitude.aggStrategy).toBe('timeWeighted')
    expect(metricRegistry.power.accessor({ power: 210 })).toBe(210)
    expect(metricRegistry.altitude.accessor({ altitude: 55 })).toBe(55)
  })
})

describe('metricUnit', () => {
  it('returns a plain string unit unchanged', () => {
    expect(metricUnit(metricRegistry.heartRate, 'running')).toBe('bpm')
  })
})

describe('isMetricForSport', () => {
  it('gates pace to running and speed to cycling', () => {
    expect(isMetricForSport('pace', 'running')).toBe(true)
    expect(isMetricForSport('pace', 'cycling')).toBe(false)
    expect(isMetricForSport('speed', 'cycling')).toBe(true)
    expect(isMetricForSport('speed', 'running')).toBe(false)
  })

  it('allows heart rate, power, altitude, and cadence for both sports', () => {
    for (const id of ['heartRate', 'power', 'altitude', 'cadence']) {
      expect(isMetricForSport(id, 'running')).toBe(true)
      expect(isMetricForSport(id, 'cycling')).toBe(true)
    }
  })
})
