import { describe, it, expect } from 'vitest'
import { metricRegistry, metricOrder } from './metricRegistry.js'
import { formatPace } from '../domain/units.js'

describe('metricOrder', () => {
  it('matches the display order fixed in ARCHITECTURE.md §6', () => {
    expect(metricOrder).toEqual(['pace', 'heartRate', 'power', 'cadence', 'altitude'])
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

  it('is the one inverted, weighted-pace, running+cycling metric', () => {
    expect(pace.invertAxis).toBe(true)
    expect(pace.aggStrategy).toBe('weightedPace')
    expect(pace.sports).toEqual(expect.arrayContaining(['running', 'cycling']))
  })

  it('format delegates to the shared formatPace formatter', () => {
    expect(pace.format(287)).toBe(formatPace(287))
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
  it('is moving-only and running-specific (bike cadence is a different field entirely)', () => {
    expect(cadence.accessor({ cadence: 172 })).toBe(172)
    expect(cadence.aggStrategy).toBe('movingOnly')
    expect(cadence.sports).toEqual(['running'])
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
