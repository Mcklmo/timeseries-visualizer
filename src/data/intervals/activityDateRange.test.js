import { describe, it, expect } from 'vitest'
import {
  EMPTY_RANGE,
  PRESETS,
  activityInRange,
  dayAfter,
  formatRangeLabel,
  isRangeActive,
  isValidRange,
  requestBoundsFor,
  startDayOf,
} from './activityDateRange.js'

const at = (startDateLocal) => ({ id: 'x', start_date_local: startDateLocal })

describe('isRangeActive / isValidRange', () => {
  it('treats one open end as an active range', () => {
    expect(isRangeActive(EMPTY_RANGE)).toBe(false)
    expect(isRangeActive({ from: '2026-03-01', to: null })).toBe(true)
    expect(isRangeActive({ from: null, to: '2026-03-31' })).toBe(true)
  })

  it('rejects only a `to` that precedes `from`', () => {
    expect(isValidRange({ from: '2026-03-01', to: '2026-03-31' })).toBe(true)
    // same day both ends is a legitimate one-day range, not an inversion
    expect(isValidRange({ from: '2026-03-01', to: '2026-03-01' })).toBe(true)
    expect(isValidRange({ from: '2026-03-31', to: '2026-03-01' })).toBe(false)
    // an open end can't be inverted
    expect(isValidRange({ from: '2026-03-31', to: null })).toBe(true)
    expect(isValidRange(EMPTY_RANGE)).toBe(true)
  })
})

describe('startDayOf', () => {
  it('reduces a local start time to its calendar day', () => {
    expect(startDayOf(at('2026-03-01T23:50:00'))).toBe('2026-03-01')
    expect(startDayOf(at('2026-03-01T00:05:00'))).toBe('2026-03-01')
  })

  it('returns null rather than a bogus day for a missing or unparseable date', () => {
    expect(startDayOf(at(undefined))).toBeNull()
    expect(startDayOf(at('not a date'))).toBeNull()
    expect(startDayOf({ id: 'stub' })).toBeNull()
    expect(startDayOf(undefined)).toBeNull()
  })
})

describe('activityInRange', () => {
  const march = { from: '2026-03-01', to: '2026-03-31' }

  it('includes both named days in full', () => {
    // the two ends are exactly where an off-by-one lives: an activity at
    // 00:30 on the last day is inside the range the athlete asked for
    expect(activityInRange(at('2026-03-01T00:30:00'), march)).toBe(true)
    expect(activityInRange(at('2026-03-31T00:30:00'), march)).toBe(true)
    expect(activityInRange(at('2026-03-31T23:59:00'), march)).toBe(true)
    expect(activityInRange(at('2026-02-28T23:59:00'), march)).toBe(false)
    expect(activityInRange(at('2026-04-01T00:01:00'), march)).toBe(false)
  })

  it('applies an open end in one direction only', () => {
    expect(activityInRange(at('2026-01-01T10:00:00'), { from: '2026-03-01', to: null })).toBe(false)
    expect(activityInRange(at('2026-12-01T10:00:00'), { from: '2026-03-01', to: null })).toBe(true)
    expect(activityInRange(at('2026-01-01T10:00:00'), { from: null, to: '2026-03-31' })).toBe(true)
    expect(activityInRange(at('2026-12-01T10:00:00'), { from: null, to: '2026-03-31' })).toBe(false)
  })

  // A Strava stub carries an id and little else. It must stay visible while
  // nobody has asked a date question (IntervalsActivityList never hides a row),
  // and drop out the moment someone does — it cannot honestly claim to be in
  // March.
  it('keeps a dateless activity when unfiltered and drops it under any range', () => {
    const stub = { id: 'i9' }
    expect(activityInRange(stub, EMPTY_RANGE)).toBe(true)
    expect(activityInRange(stub, march)).toBe(false)
    expect(activityInRange(stub, { from: null, to: '2026-03-31' })).toBe(false)
    expect(activityInRange(at('nonsense'), march)).toBe(false)
  })

  it('matches nothing at all when the range is inverted', () => {
    expect(activityInRange(at('2026-03-15T10:00:00'), { from: '2026-03-31', to: '2026-03-01' })).toBe(false)
  })
})

describe('requestBoundsFor', () => {
  const FALLBACK = '2026-05-10'

  it('falls back to the browse window when no start is named', () => {
    expect(requestBoundsFor(EMPTY_RANGE, FALLBACK)).toEqual({ oldest: FALLBACK })
    expect(requestBoundsFor({ from: '2026-03-01', to: null }, FALLBACK)).toEqual({ oldest: '2026-03-01' })
  })

  // The whole reason this function exists: `newest` is midnight at the START
  // of its day, so an inclusive end has to be sent as the day after — or a
  // range ending today returns nothing recorded today.
  it('sends `newest` as the day after the last day the athlete asked for', () => {
    expect(requestBoundsFor({ from: null, to: '2026-03-15' }, FALLBACK).newest).toBe('2026-03-16')
    expect(requestBoundsFor({ from: '2026-03-01', to: '2026-03-31' }, FALLBACK)).toEqual({
      oldest: '2026-03-01',
      newest: '2026-04-01',
    })
  })

  it('rolls the +1 day over month, leap-day and year boundaries', () => {
    expect(dayAfter('2026-03-31')).toBe('2026-04-01')
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
    expect(dayAfter('2028-02-28')).toBe('2028-02-29') // 2028 is a leap year
    expect(dayAfter('2026-02-28')).toBe('2026-03-01')
    expect(requestBoundsFor({ from: '2026-12-01', to: '2026-12-31' }, FALLBACK).newest).toBe('2027-01-01')
  })

  it('omits `newest` entirely rather than sending an empty value', () => {
    expect('newest' in requestBoundsFor({ from: '2026-03-01', to: null }, FALLBACK)).toBe(false)
  })
})

describe('PRESETS', () => {
  it('all end today, and reach back their stated span', () => {
    const today = new Date(2026, 7, 8) // 8 Aug 2026, local
    const byId = Object.fromEntries(PRESETS.map((preset) => [preset.id, preset.rangeFor(today)]))

    expect(byId['30d']).toEqual({ from: '2026-07-09', to: '2026-08-08' })
    expect(byId['3m']).toEqual({ from: '2026-05-10', to: '2026-08-08' })
    expect(byId['12m']).toEqual({ from: '2025-08-08', to: '2026-08-08' })
    for (const preset of PRESETS) expect(preset.rangeFor(today).to).toBe('2026-08-08')
  })

  it('crosses a year boundary going backwards', () => {
    expect(PRESETS.find((p) => p.id === '3m').rangeFor(new Date(2026, 0, 15)).from).toBe('2025-10-17')
  })
})

describe('formatRangeLabel', () => {
  it('reads as a sentence fragment, en-GB, day before month', () => {
    expect(formatRangeLabel({ from: '2026-03-01', to: '2026-03-31' })).toBe('between 1 Mar and 31 Mar 2026')
    expect(formatRangeLabel({ from: '2025-12-01', to: '2026-03-31' })).toBe(
      'between 1 Dec 2025 and 31 Mar 2026',
    )
    expect(formatRangeLabel({ from: '2026-03-01', to: null })).toBe('on or after 1 Mar 2026')
    expect(formatRangeLabel({ from: null, to: '2026-03-31' })).toBe('on or before 31 Mar 2026')
  })

  // Null is the caller's signal to use its own unfiltered copy instead.
  it('says nothing when there is no range', () => {
    expect(formatRangeLabel(EMPTY_RANGE)).toBeNull()
  })
})
