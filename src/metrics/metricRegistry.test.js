import { describe, it, expect } from 'vitest'
import {
  derivativeKindFor,
  derivativeStatKinds,
  isMetricForSport,
  metricRegistry,
  metricOrder,
  metricUnit,
  scalarStatKinds,
  statKinds,
  statKindsFor,
} from './metricRegistry.js'
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

  it('is a non-inverted, moving-only metric, and the "how fast" panel for everything except running', () => {
    expect(speed.invertAxis).toBe(false)
    expect(speed.aggStrategy).toBe('movingOnly')
    // A GPS-only track gets speed rather than pace: min/km is meaningless at
    // breadcrumb sampling rates.
    expect(speed.sports).toEqual(['cycling', 'track'])
    expect(metricRegistry.pace.sports).toEqual(['running'])
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
  it('is moving-only and available for every sport, with a sport-dependent unit', () => {
    expect(cadence.accessor({ cadence: 172 })).toBe(172)
    expect(cadence.aggStrategy).toBe('movingOnly')
    expect(cadence.sports).toEqual(['running', 'cycling', 'track'])
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

describe('stat kinds', () => {
  it('appends the derivative kinds after the scalars, in one list', () => {
    // Order is load-bearing three times over: checkbox order, draw order, and
    // the order viewPrefsStore's filterToKnown re-sorts stored prefs into.
    expect(scalarStatKinds).toEqual(['max', 'min', 'avg', 'median'])
    expect(derivativeStatKinds).toEqual(['d1', 'd2'])
    expect(statKinds).toEqual(['max', 'min', 'avg', 'median', 'd1', 'd2'])
  })

  it('offers derivatives only to metrics that declare a spec', () => {
    // §2.3: not pace (its accessor nulls anything under 0.3 m/s, and d/dt of
    // min/km is unreadable) and not cadence.
    for (const id of ['altitude', 'heartRate', 'speed', 'power']) {
      expect(statKindsFor(metricRegistry[id])).toEqual(statKinds)
    }
    for (const id of ['pace', 'cadence']) {
      expect(statKindsFor(metricRegistry[id])).toEqual(scalarStatKinds)
      expect(metricRegistry[id].derivative).toBeUndefined()
    }
  })

  it('gives every derivative spec a label, unit, scale and signed formatter', () => {
    for (const id of ['altitude', 'heartRate', 'speed', 'power']) {
      for (const kind of derivativeStatKinds) {
        const spec = metricRegistry[id].derivative[kind]
        expect(spec.label).toBeTruthy()
        expect(spec.unit).toBeTruthy()
        expect(spec.perSecondScale).toBeGreaterThan(0)
        // The sign IS the reading, so a positive rate must print one.
        expect(spec.format(1.5)).toMatch(/^\+/)
        expect(spec.format(-1.5)).toMatch(/^-/)
        // ...but zero is the axis centre, not a small positive.
        expect(spec.format(0)).not.toMatch(/^[+-]/)
      }
    }
  })

  it('scales per-second differences into the units it labels the axis with', () => {
    // derivativeSeries returns value-units per second; accessor units vary.
    expect(metricRegistry.heartRate.derivative.d1.perSecondScale).toBe(60) // bpm/s -> bpm/min
    expect(metricRegistry.heartRate.derivative.d2.perSecondScale).toBe(3600)
    expect(metricRegistry.altitude.derivative.d1.perSecondScale).toBe(60) // m/s -> m/min
    expect(metricRegistry.power.derivative.d1.perSecondScale).toBe(1) // already W/s
    // speed's accessor is km/h, so its per-second difference needs ÷3.6 to be m/s².
    expect(metricRegistry.speed.derivative.d1.perSecondScale).toBeCloseTo(1 / 3.6, 12)
    expect(metricRegistry.speed.derivative.d1.unit).toBe('m/s²')
  })
})

describe('derivativeKindFor', () => {
  const { heartRate, cadence } = metricRegistry

  it('picks the enabled derivative and ignores the scalar stats beside it', () => {
    expect(derivativeKindFor(heartRate, ['max', 'd1', 'avg'])).toBe('d1')
    expect(derivativeKindFor(heartRate, ['d2'])).toBe('d2')
    expect(derivativeKindFor(heartRate, ['max', 'avg'])).toBeNull()
    expect(derivativeKindFor(heartRate, [])).toBeNull()
  })

  it('returns null for a metric that offers no derivative, whatever is stored against it', () => {
    // viewPrefsStore validates stored kinds against the GLOBAL statKinds, so a
    // hand-edited sessionStorage entry really can carry 'd1' for cadence. If
    // this returned 'd1', ChartStack would reserve 44px of gutter on every
    // panel for an overlay MetricPanel can never draw.
    expect(derivativeKindFor(cadence, ['d1'])).toBeNull()
    expect(derivativeKindFor(cadence, ['avg', 'd2'])).toBeNull()
  })
})

describe('isMetricForSport', () => {
  it('gates pace to running and speed to cycling', () => {
    expect(isMetricForSport('pace', 'running')).toBe(true)
    expect(isMetricForSport('pace', 'cycling')).toBe(false)
    expect(isMetricForSport('speed', 'cycling')).toBe(true)
    expect(isMetricForSport('speed', 'running')).toBe(false)
  })

  it('allows heart rate, power, altitude, and cadence for every sport', () => {
    for (const id of ['heartRate', 'power', 'altitude', 'cadence']) {
      expect(isMetricForSport(id, 'running')).toBe(true)
      expect(isMetricForSport(id, 'cycling')).toBe(true)
      expect(isMetricForSport(id, 'track')).toBe(true)
    }
  })

  it('gives a GPS-only track speed rather than pace', () => {
    expect(isMetricForSport('speed', 'track')).toBe(true)
    expect(isMetricForSport('pace', 'track')).toBe(false)
  })
})
