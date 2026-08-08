import { describe, it, expect } from 'vitest'
import {
  mpsToSecPerKm,
  mpsToKmh,
  formatPace,
  formatSpeedKmh,
  formatDuration,
  formatDistanceKm,
  formatStartDateTime,
  makeElapsedTickFormatter,
  makeDistanceTickFormatter,
} from './units.js'

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

  it('rolls hours into days past 24h instead of counting on to 72:00:00', () => {
    expect(formatDuration(86400)).toBe('1d 0:00:00')
    expect(formatDuration(2 * 86400 + 4 * 3600 + 15 * 60 + 30)).toBe('2d 4:15:30')
  })

  it('is unchanged for anything under a day', () => {
    expect(formatDuration(86399)).toBe('23:59:59')
  })
})

describe('formatStartDateTime', () => {
  // Built from local components on purpose: the formatter renders in the
  // viewer's zone, so a UTC literal here would make this assertion depend on
  // the machine's TZ.
  it('formats day-before-month, 24-hour, no weekday', () => {
    expect(formatStartDateTime(new Date(2026, 7, 8, 7, 14))).toBe('8 Aug 2026, 07:14')
  })

  it('zero-pads the hour rather than dropping to a 12-hour clock', () => {
    expect(formatStartDateTime(new Date(2026, 11, 31, 23, 5))).toBe('31 Dec 2026, 23:05')
  })

  // The header renders no element at all for a null — 'Invalid Date' in a
  // screenshot is worse than no date, and GPX in particular can arrive
  // without a usable timestamp.
  it('returns null for a missing or unparseable start time', () => {
    expect(formatStartDateTime(null)).toBeNull()
    expect(formatStartDateTime(undefined)).toBeNull()
    expect(formatStartDateTime(new Date('not a date'))).toBeNull()
    expect(formatStartDateTime('2026-08-08T07:14:00Z')).toBeNull()
  })
})

describe('makeElapsedTickFormatter', () => {
  // Recharts stacks a tick label's whitespace-separated words on separate
  // lines, so no tick may contain a space — see units.js.
  it('never emits a space, at any span', () => {
    for (const span of [60, 600, 3600, 20000, 259200]) {
      const format = makeElapsedTickFormatter(span)
      for (const v of [0, span / 3, span]) expect(format(v)).not.toMatch(/\s/)
    }
  })

  it('reads m:ss for a short activity', () => {
    const format = makeElapsedTickFormatter(300)
    expect([0, 150, 300].map(format)).toEqual(['0:00', '2:30', '5:00'])
  })

  it('reads h:mm for an activity of a few hours', () => {
    const format = makeElapsedTickFormatter(2 * 3600)
    expect([0, 1800, 3600].map(format)).toEqual(['0:00', '0:30', '1:00'])
  })

  it('reads whole hours for a sub-day span', () => {
    const format = makeElapsedTickFormatter(18 * 3600)
    expect([0, 6 * 3600, 12 * 3600].map(format)).toEqual(['0h', '6h', '12h'])
  })

  it('reads days and hours past 24h — the axis that used to print 259200', () => {
    const format = makeElapsedTickFormatter(3 * 86400)
    expect([0, 86400, 2 * 86400, 2.5 * 86400].map(format)).toEqual(['0h', '1d0h', '2d0h', '2d12h'])
  })

  it('falls back to the finest band for an unknown span rather than the coarsest', () => {
    expect(makeElapsedTickFormatter(undefined)(90)).toBe('1:30')
  })
})

describe('makeDistanceTickFormatter', () => {
  it('reads metres below a kilometre', () => {
    const format = makeDistanceTickFormatter(800)
    expect([0, 200, 800].map(format)).toEqual(['0m', '200m', '800m'])
  })

  it('reads kilometres above one, to one decimal', () => {
    const format = makeDistanceTickFormatter(100000)
    expect([0, 25000, 100000].map(format)).toEqual(['0.0km', '25.0km', '100.0km'])
  })

  it('never emits a space', () => {
    expect(makeDistanceTickFormatter(5000)(1234)).not.toMatch(/\s/)
  })
})

describe('formatDistanceKm', () => {
  it('formats metres as km with two decimals', () => {
    expect(formatDistanceKm(10000)).toBe('10.00 km')
    expect(formatDistanceKm(3210)).toBe('3.21 km')
  })
})
