import { describe, it, expect } from 'vitest'
import { mpsToSecPerKm, mpsToKmh, formatPace, formatSpeedKmh, formatDuration, formatDistanceKm } from './units.js'

describe('mpsToSecPerKm', () => {
  it('converts speed to seconds-per-km pace', () => {
    // 1000m in 240s => 4.1667 m/s => 240 s/km
    expect(mpsToSecPerKm(1000 / 240)).toBeCloseTo(240, 6)
  })

  it('returns null for zero or negative speed (avoid Infinity in charts)', () => {
    expect(mpsToSecPerKm(0)).toBeNull()
    expect(mpsToSecPerKm(-1)).toBeNull()
  })
})

describe('mpsToKmh', () => {
  it('converts m/s to km/h', () => {
    expect(mpsToKmh(10)).toBeCloseTo(36, 6)
    expect(mpsToKmh(0)).toBe(0)
  })
})

describe('formatSpeedKmh', () => {
  it('formats to one decimal place', () => {
    expect(formatSpeedKmh(28.42)).toBe('28.4')
    expect(formatSpeedKmh(0)).toBe('0.0')
  })

  it('returns a placeholder for null/undefined/non-finite input', () => {
    expect(formatSpeedKmh(null)).toBe('–')
    expect(formatSpeedKmh(undefined)).toBe('–')
    expect(formatSpeedKmh(NaN)).toBe('–')
  })
})

describe('formatPace', () => {
  it('formats the architecture-spec example: 287 -> 4:47', () => {
    expect(formatPace(287)).toBe('4:47')
  })

  it('zero-pads seconds under 10', () => {
    expect(formatPace(305)).toBe('5:05')
  })

  it('handles sub-minute pace', () => {
    expect(formatPace(45)).toBe('0:45')
  })

  it('returns a placeholder for null/undefined input', () => {
    expect(formatPace(null)).toBe('–')
    expect(formatPace(undefined)).toBe('–')
  })
})

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(125)).toBe('2:05')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('zero-pads minutes when hours are present', () => {
    expect(formatDuration(3665)).toBe('1:01:05')
  })
})

describe('formatDistanceKm', () => {
  it('formats metres as km with two decimals', () => {
    expect(formatDistanceKm(10000)).toBe('10.00 km')
    expect(formatDistanceKm(3210)).toBe('3.21 km')
  })
})
