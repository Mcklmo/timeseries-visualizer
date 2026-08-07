import { describe, it, expect } from 'vitest'
import { deriveWorkoutName } from './deriveWorkoutName.js'

describe('deriveWorkoutName', () => {
  it('labels hour 4 Night and hour 5 Morning (the Night->Morning boundary)', () => {
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 4) })).toBe('Night Run')
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 5) })).toBe('Morning Run')
  })

  it('labels hour 11 Morning and hour 12 Afternoon (the Morning->Afternoon boundary)', () => {
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 11) })).toBe('Morning Run')
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 12) })).toBe('Afternoon Run')
  })

  it('labels hour 16 Afternoon and hour 17 Evening (the Afternoon->Evening boundary)', () => {
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 16) })).toBe('Afternoon Run')
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 17) })).toBe('Evening Run')
  })

  it('labels hour 20 Evening and hour 21 Night (the Evening->Night boundary)', () => {
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 20) })).toBe('Evening Run')
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 21) })).toBe('Night Run')
  })

  it('labels both hour 0 and hour 23 Night', () => {
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 0) })).toBe('Night Run')
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 23) })).toBe('Night Run')
  })

  it('falls back to "Run" for running and "Ride" for cycling when no sportLabel is given', () => {
    expect(deriveWorkoutName({ sport: 'running', startTime: new Date(2026, 0, 1, 6) })).toBe('Morning Run')
    expect(deriveWorkoutName({ sport: 'cycling', startTime: new Date(2026, 0, 1, 6) })).toBe('Morning Ride')
  })

  it('uses sportLabel verbatim (casing preserved) when present, overriding the sport fallback', () => {
    expect(
      deriveWorkoutName({ sport: 'running', sportLabel: 'Trail Run', startTime: new Date(2026, 0, 1, 6) }),
    ).toBe('Morning Trail Run')
    expect(
      deriveWorkoutName({ sport: 'running', sportLabel: 'TRAIL RUN', startTime: new Date(2026, 0, 1, 6) }),
    ).toBe('Morning TRAIL RUN')
  })

  it('falls back to the sport map when sportLabel is whitespace-only, empty, or undefined', () => {
    const startTime = new Date(2026, 0, 1, 6)
    expect(deriveWorkoutName({ sport: 'running', sportLabel: '   ', startTime })).toBe('Morning Run')
    expect(deriveWorkoutName({ sport: 'running', sportLabel: '', startTime })).toBe('Morning Run')
    expect(deriveWorkoutName({ sport: 'running', sportLabel: undefined, startTime })).toBe('Morning Run')
  })
})
