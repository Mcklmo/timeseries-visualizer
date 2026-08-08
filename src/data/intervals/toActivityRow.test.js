import { describe, it, expect } from 'vitest'
import { toActivityRow, unsupportedReason } from './toActivityRow.js'

const garminRun = {
  id: 'i1',
  name: 'Tempo 5×1k',
  type: 'Run',
  start_date_local: '2026-08-11T17:04:00',
  icu_distance: 12400,
  moving_time: 3492,
  file_type: 'fit',
  source: 'GARMIN_CONNECT',
  device_name: 'Forerunner 965',
}

describe('unsupportedReason', () => {
  it('passes a normal Garmin activity', () => {
    expect(unsupportedReason(garminRun)).toBeNull()
  })

  it('names Strava as the reason its original is missing', () => {
    expect(unsupportedReason({ id: 'i2', name: 'Ride', source: 'STRAVA' })).toMatch(/strava/i)
  })

  it('rejects a file type no parser handles', () => {
    expect(unsupportedReason({ id: 'i2', name: 'X', file_type: 'csv' })).toMatch(/file type isn't supported/i)
  })

  // GPX is a supported third format, so a GPX original is pickable — the
  // flip that landed with GPX support (ARCHITECTURE.md §8).
  it.each(['fit', 'tcx', 'gpx', 'FIT'])('accepts %s originals', (fileType) => {
    expect(unsupportedReason({ id: 'i2', name: 'X', start_date_local: '2026-08-11T17:04:00', file_type: fileType })).toBeNull()
  })

  // The bytes are the authority (data/fileFormat.js); file_type is only
  // a pre-flight hint, so its absence must never disable a row.
  it('leaves a row without a file_type pickable', () => {
    expect(unsupportedReason({ id: 'i2', name: 'X', start_date_local: '2026-08-11T17:04:00' })).toBeNull()
  })

  it('explains an empty stub row', () => {
    expect(unsupportedReason({ id: 'i2' })).toMatch(/details aren't available/i)
  })
})

describe('toActivityRow', () => {
  it('renames every field the wire uses into the neutral one', () => {
    expect(toActivityRow(garminRun)).toEqual({
      id: 'i1',
      name: 'Tempo 5×1k',
      startedAt: '2026-08-11T17:04:00',
      // Always null here: intervals.icu does report a real UTC start_date, but
      // it is not in ACTIVITY_LIST_FIELDS and this path has no use for it —
      // the original file it downloads carries absolute timestamps already.
      startedAtUtc: null,
      distanceM: 12400,
      durationS: 3492,
      sportLabel: 'Run',
      unsupportedReason: null,
      isGarminDerived: true,
    })
  })

  // The one case the whole mapper has to survive: intervals.icu returns
  // Strava-synced activities as stubs where `id` really can be the only
  // property present, so no guard here may assume a second field exists.
  it('maps an id-only stub without throwing', () => {
    expect(toActivityRow({ id: 'i9' })).toEqual({
      id: 'i9',
      name: undefined,
      startedAt: null,
      startedAtUtc: null,
      distanceM: null,
      durationS: null,
      sportLabel: null,
      unsupportedReason: "This activity's details aren't available.",
      isGarminDerived: false,
    })
  })

  // Zero is a gap in the data, not a measurement: `0.00 km` on a row reads as
  // a fact the athlete then has to disbelieve.
  it('reports a non-positive distance or duration as absent rather than as zero', () => {
    const row = toActivityRow({ id: 'i2', name: 'Manual', icu_distance: 0, moving_time: -1 })
    expect(row.distanceM).toBeNull()
    expect(row.durationS).toBeNull()
  })

  it('falls back to elapsed_time when moving_time is absent', () => {
    expect(toActivityRow({ id: 'i3', elapsed_time: 3492 }).durationS).toBe(3492)
    // and prefers moving_time when both are reported
    expect(toActivityRow({ id: 'i4', moving_time: 3000, elapsed_time: 3492 }).durationS).toBe(3000)
  })

  // `||` not `??`, deliberately: an empty title has to reach the list's
  // 'Untitled activity' placeholder, and must never be handed to the chart in
  // place of the name deriveWorkoutName infers.
  it('drops an empty name entirely instead of carrying the empty string', () => {
    expect(toActivityRow({ id: 'i5', name: '' }).name).toBeUndefined()
  })

  // Appending one would shift the athlete's own wall clock into their offset a
  // second time — the single easiest thing to get wrong in this folder.
  it('carries the local start time through untouched, with no trailing Z', () => {
    expect(toActivityRow({ id: 'i6', start_date_local: '2026-08-11T17:04:00' }).startedAt).toBe(
      '2026-08-11T17:04:00',
    )
  })

  // Attribution is owed for anything Garmin-derived (intervals.icu API Terms
  // §1.1, Strava API Policy §4.4), and a row can say so either way.
  it('treats a Garmin source and a Garmin device name as equally attributable', () => {
    expect(toActivityRow({ id: 'i7', name: 'X', source: 'GARMIN_CONNECT' }).isGarminDerived).toBe(true)
    expect(toActivityRow({ id: 'i8', name: 'X', device_name: 'Forerunner 965' }).isGarminDerived).toBe(true)
    expect(toActivityRow({ id: 'i9', name: 'X', source: 'STRAVA' }).isGarminDerived).toBe(false)
  })
})
