import { describe, it, expect } from 'vitest'
import { toActivityRow, unsupportedReason } from './toActivityRow.js'

// A Garmin-synced run, in Strava's own field names and spellings — including
// the trailing Z that start_date_local should not have.
const garminRun = {
  id: 12345678901,
  resource_state: 2,
  name: 'Tempo 5×1k',
  distance: 12400.5,
  moving_time: 3492,
  elapsed_time: 3600,
  sport_type: 'TrailRun',
  type: 'Run',
  start_date: '2026-08-11T15:04:00Z',
  start_date_local: '2026-08-11T17:04:00Z',
  external_id: 'garmin_push_9876543210',
  manual: false,
}

describe('unsupportedReason', () => {
  it('greys out a manual entry — there is no stream set behind one', () => {
    expect(unsupportedReason({ ...garminRun, manual: true })).toMatch(/by hand/i)
  })

  it('greys out a meta-only row', () => {
    expect(unsupportedReason({ id: 1, resource_state: 1 })).toMatch(/details aren't available/i)
  })

  it('passes a normal recorded activity', () => {
    expect(unsupportedReason(garminRun)).toBeNull()
  })

  // A pre-flight guard only. It must not invent reasons: a run with no power
  // meter, no name or no distance is still perfectly loadable.
  it('does not grey out a row merely for missing optional fields', () => {
    expect(unsupportedReason({ id: 1, resource_state: 2 })).toBeNull()
  })
})

describe('toActivityRow', () => {
  it('renames every field the wire uses into the neutral one', () => {
    expect(toActivityRow(garminRun)).toEqual({
      id: '12345678901',
      name: 'Tempo 5×1k',
      startedAt: '2026-08-11T17:04:00',
      startedAtUtc: '2026-08-11T15:04:00Z',
      distanceM: 12400.5,
      durationS: 3492,
      sportLabel: 'Trail Run',
      unsupportedReason: null,
      isGarminDerived: true,
    })
  })

  // Strava ids are JSON numbers. ActivityRow.id is a string, mergeById keys a
  // Set on it, React keys on it, and it is interpolated into a URL path.
  it('coerces the numeric id to a string', () => {
    const row = toActivityRow(garminRun)
    expect(row.id).toBe('12345678901')
    expect(typeof row.id).toBe('string')
  })

  // THE date trap. start_date_local is the athlete's wall clock but is spelled
  // as though it were UTC. Left as-is, every row west of Greenwich lands on
  // the wrong calendar day — where the 90-day filter, on by default, drops it.
  it('strips the bogus trailing Z from the local start, and keeps the real UTC one', () => {
    const row = toActivityRow(garminRun)

    expect(row.startedAt).toBe('2026-08-11T17:04:00')
    expect(row.startedAt.endsWith('Z')).toBe(false)
    // The instant is not lost — it is the separate field the adapter needs to
    // rebuild timestamps from Strava's relative `time` stream.
    expect(row.startedAtUtc).toBe('2026-08-11T15:04:00Z')
  })

  it('does not shift the calendar day west of Greenwich', () => {
    // 23:30 local on the 11th, which is 03:30 UTC on the 12th.
    const row = toActivityRow({
      ...garminRun,
      start_date_local: '2026-08-11T23:30:00Z',
      start_date: '2026-08-12T03:30:00Z',
    })
    expect(new Date(row.startedAt).getDate()).toBe(11)
  })

  // `||` not `??`: an empty title must fall through to the list placeholder
  // and to a ref with no `name`, so the chart keeps its derived name.
  it('drops an empty-string name rather than keeping it', () => {
    expect(toActivityRow({ ...garminRun, name: '' }).name).toBeUndefined()
  })

  it('prefers sport_type over the deprecated type, which collapses the variants', () => {
    expect(toActivityRow(garminRun).sportLabel).toBe('Trail Run')
    expect(toActivityRow({ ...garminRun, sport_type: undefined }).sportLabel).toBe('Run')
  })

  it('reads a zero or negative measurement as "didn’t say"', () => {
    const row = toActivityRow({ ...garminRun, distance: 0, moving_time: -1, elapsed_time: 0 })
    expect(row.distanceM).toBeNull()
    expect(row.durationS).toBeNull()
  })

  it('falls back to elapsed_time when moving_time is absent', () => {
    expect(toActivityRow({ ...garminRun, moving_time: undefined }).durationS).toBe(3600)
  })

  // device_name is a DetailedActivity field, so the intervals.icu mapper's
  // test cannot be used on a list row. external_id can.
  describe('Garmin attribution (API Policy §4.4)', () => {
    it.each([
      ['garmin_push_9876543210', true],
      ['garmin_ping_1', true],
      ['wahoo_1234', false],
      [undefined, false],
      [null, false],
      [12345, false],
    ])('external_id %s -> %s', (externalId, expected) => {
      expect(toActivityRow({ ...garminRun, external_id: externalId }).isGarminDerived).toBe(expected)
    })
  })

  it('maps an id-only stub without throwing', () => {
    expect(toActivityRow({ id: 42 })).toEqual({
      id: '42',
      name: undefined,
      startedAt: null,
      startedAtUtc: null,
      distanceM: null,
      durationS: null,
      sportLabel: null,
      unsupportedReason: null,
      isGarminDerived: false,
    })
  })
})
