import { describe, it, expect } from 'vitest'
import { activityKeyOf } from './activityKey.js'

const base = {
  sport: 'running',
  startTime: new Date('2026-08-07T07:12:34.000Z'),
  totalTime: 3847.4,
  totalDistance: 10231.8,
  samples: new Array(1801),
  availableMetrics: ['pace', 'speed', 'heartRate', 'power', 'cadence', 'altitude'],
}

describe('activityKeyOf', () => {
  it('is deterministic: the same content yields the same key', () => {
    // Fresh Date objects and a fresh samples array on purpose — identity of
    // the inputs must not matter, only their content.
    const again = { ...base, startTime: new Date('2026-08-07T07:12:34.000Z'), samples: new Array(1801) }
    expect(activityKeyOf(base)).toBe(activityKeyOf(again))
  })

  it('reads as sport-timestamp-duration-hash', () => {
    expect(activityKeyOf(base)).toMatch(/^[a-z]+-[0-9TZ]+-\d+s-[0-9a-f]{8}$/)
    expect(activityKeyOf(base)).toBe(`running-20260807T0712Z-3847s-${activityKeyOf(base).slice(-8)}`)
  })

  it('separates two starts one second apart, which the minute-resolution prefix cannot show', () => {
    const shifted = { ...base, startTime: new Date('2026-08-07T07:12:35.000Z') }
    // Same readable prefix, different hash — the assertion that the full
    // timestamp really is in the hashed input and not just the label.
    expect(activityKeyOf(shifted).slice(0, -8)).toBe(activityKeyOf(base).slice(0, -8))
    expect(activityKeyOf(shifted)).not.toBe(activityKeyOf(base))
  })

  it('separates recordings that differ only in sample count', () => {
    expect(activityKeyOf({ ...base, samples: new Array(1800) })).not.toBe(activityKeyOf(base))
  })

  it('separates recordings that differ only in sport, distance or available metrics', () => {
    expect(activityKeyOf({ ...base, sport: 'cycling' })).not.toBe(activityKeyOf(base))
    expect(activityKeyOf({ ...base, totalDistance: 10232.8 })).not.toBe(activityKeyOf(base))
    expect(activityKeyOf({ ...base, availableMetrics: ['pace', 'speed'] })).not.toBe(activityKeyOf(base))
  })

  it('ignores sub-second float noise in the derived totals', () => {
    // buildDistanceAxis sums haversine hops; a rebuild landing a few
    // centimetres off must not fork the key for the same file.
    expect(activityKeyOf({ ...base, totalDistance: 10231.9, totalTime: 3847.3 })).toBe(activityKeyOf(base))
  })

  it('ignores anything not in the fingerprint, so both ingestion paths agree', () => {
    // intervals.icu overrides `name` after normalizeActivity returns; a key
    // that moved with it would differ between a dropped file and the download
    // of that same file.
    expect(activityKeyOf({ ...base, name: 'Tempo 5x1k', id: 'fit-1754553154000' })).toBe(activityKeyOf(base))
  })

  it('is total: an invalid, missing or garbage input still yields a key', () => {
    // An unparseable timestamp survives the parsers' `time != null` filter as
    // an Invalid Date, and toISOString() throws on one.
    expect(activityKeyOf({ ...base, startTime: new Date('not a date') })).toMatch(/^running-0{8}T0{4}Z-\d+s-[0-9a-f]{8}$/)
    expect(activityKeyOf({})).toMatch(/^activity-[0-9TZ]+-0s-[0-9a-f]{8}$/)
    expect(activityKeyOf()).toMatch(/^activity-[0-9TZ]+-0s-[0-9a-f]{8}$/)
  })
})
