// Tier 1 of the three that replace the byte-fidelity guarantee the file
// parsers have. The other three sources share a four-route cross-check — one
// real Garmin activity, asserted through file-TCX, file-FIT, file-GPX and
// network-FIT to identical numbers — which Strava cannot join exactly: there
// is no original-file endpoint and Strava resamples.
//
// **This tier catches the class of bug that cross-check used to catch**, on
// synthetic input, by asserting invariants rather than values: what the output
// length must be, what may never appear in it, and the one conversion that
// fails silently.
import { describe, it, expect } from 'vitest'
import { streamsToTrackpoints } from './streamsToTrackpoints.js'

const START = new Date('2026-03-01T08:00:00Z')

/** Streams in Strava's `key_by_type=true` shape. */
const streamSet = (streams) =>
  Object.fromEntries(
    Object.entries(streams).map(([type, data]) => [type, { type, data, series_type: 'distance' }]),
  )

const assemble = (streams, { sport = 'running', startTime = START } = {}) =>
  streamsToTrackpoints({ streams: streamSet(streams), startTime, sport })

describe('the time spine', () => {
  it('produces exactly one trackpoint per time entry', () => {
    const points = assemble({ time: [0, 1, 2, 3, 4], heartrate: [140, 141, 142, 143, 144] })
    expect(points).toHaveLength(5)
  })

  it('rebuilds absolute timestamps from the start instant and the offsets', () => {
    const points = assemble({ time: [0, 30, 90] })
    expect(points.map((p) => p.time.toISOString())).toEqual([
      '2026-03-01T08:00:00.000Z',
      '2026-03-01T08:00:30.000Z',
      '2026-03-01T08:01:30.000Z',
    ])
  })

  // RawTrackpoint.time is non-optional and normalizeActivity calls .getTime()
  // on it unguarded, so there is no such thing as a trackpoint without one.
  it('throws no_streams when the time stream is absent or empty', () => {
    for (const streams of [{}, { time: [] }, { heartrate: [140] }]) {
      expect(() => assemble(streams)).toThrow(expect.objectContaining({ code: 'no_streams' }))
    }
  })

  it('throws no_streams rather than producing Invalid Dates for a bad start', () => {
    expect(() => assemble({ time: [0, 1] }, { startTime: new Date('nonsense') })).toThrow(
      expect.objectContaining({ code: 'no_streams' }),
    )
  })
})

// THE trap. Strava's cadence stream is RPM, and for a foot sport that is one
// leg — so a run recorded at ~170 spm arrives as ~85. Miss the doubling and
// every Strava run charts at half its real cadence, and nothing throws.
describe('cadence doubling (foot sports only)', () => {
  it('doubles cadence for running', () => {
    const points = assemble({ time: [0, 1], cadence: [85, 86] }, { sport: 'running' })
    expect(points.map((p) => p.cadenceSpm)).toEqual([170, 172])
  })

  it('leaves cycling cadence alone — it is already pedal rpm', () => {
    const points = assemble({ time: [0, 1], cadence: [85, 86] }, { sport: 'cycling' })
    expect(points.map((p) => p.cadenceSpm)).toEqual([85, 86])
  })

  // Documented consequence of sportFor's fallback: an unknown foot sport lands
  // in `track` and is not doubled. Pinned so the cost stays visible.
  it('does not double for track, the unknown-sport fallback', () => {
    const points = assemble({ time: [0], cadence: [85] }, { sport: 'track' })
    expect(points[0].cadenceSpm).toBe(170)
  })
})

describe('dropouts and ragged streams', () => {
  // Strava reports a sensor dropout as a null at that index.
  it('never produces a key holding null', () => {
    const points = assemble({
      time: [0, 1, 2],
      heartrate: [140, null, 142],
      watts: [null, null, null],
      distance: [0, null, 20],
    })

    for (const point of points) {
      for (const [key, value] of Object.entries(point)) {
        expect(value, `${key} held null`).not.toBeNull()
      }
    }
    expect(points[1].heartRateBpm).toBeUndefined()
    expect(points[0].heartRateBpm).toBe(140)
  })

  it('omits an absent stream entirely rather than adding empty keys', () => {
    const [point] = assemble({ time: [0], heartrate: [140] })
    expect(Object.keys(point).sort()).toEqual(['heartRateBpm', 'time'])
  })

  // Strava normally returns equal lengths. "Normally" is not a contract, and
  // reading past the end of an array must not become a value.
  it('never yields undefined from a stream shorter than time', () => {
    const points = assemble({ time: [0, 1, 2, 3], heartrate: [140, 141] })

    expect(points).toHaveLength(4)
    expect(points[3].heartRateBpm).toBeUndefined()
    expect('heartRateBpm' in points[3]).toBe(false)
    expect(points[1].heartRateBpm).toBe(141)
  })

  it('drops a non-finite time offset rather than placing an Invalid Date', () => {
    const points = assemble({ time: [0, null, 2], heartrate: [140, 141, 142] })
    expect(points).toHaveLength(2)
    expect(points.every((p) => !Number.isNaN(p.time.getTime()))).toBe(true)
  })
})

// latlng entries are [lat, lng] arrays, unlike every other stream's scalars.
describe('latlng', () => {
  it('maps a well-formed pair', () => {
    const [point] = assemble({ time: [0], latlng: [[57.048, 9.9187]] })
    expect(point).toMatchObject({ lat: 57.048, lon: 9.9187 })
  })

  it.each([[null], [[]], [[57.048]], ['57,9'], [[null, null]], [[57.048, null]]])(
    'drops a malformed entry (%j) instead of crashing on it',
    (entry) => {
      const points = assemble({ time: [0, 1], latlng: [entry, [57.048, 9.9187]] })

      expect(points).toHaveLength(2)
      expect('lat' in points[0]).toBe(false)
      expect('lon' in points[0]).toBe(false)
      expect(points[1]).toMatchObject({ lat: 57.048, lon: 9.9187 })
    },
  )
})

// Not requesting `moving` is a stronger form of discarding it — there is no
// field for a later change to start reading. normalizeActivity derives pauses
// with detectPauses so every format behaves identically.
describe('moving', () => {
  it('never appears in the output, even when Strava sends it', () => {
    const points = assemble({ time: [0, 1, 2], moving: [true, false, true] })

    for (const point of points) {
      expect(point).not.toHaveProperty('moving')
      expect(Object.keys(point)).toEqual(['time'])
    }
  })
})

// Mapped knowingly: deriveSpeed short-circuits on any speedMps, so Strava's
// pre-smoothed speed drives the pace chart on this path.
describe('velocity_smooth', () => {
  it('maps to speedMps', () => {
    const points = assemble({ time: [0, 1], velocity_smooth: [3.2, 3.4] })
    expect(points.map((p) => p.speedMps)).toEqual([3.2, 3.4])
  })
})

describe('the remaining field mapping', () => {
  it('renames every stream this app reads into its RawTrackpoint name', () => {
    const [point] = assemble({
      time: [0],
      distance: [1234.5],
      altitude: [42],
      heartrate: [151],
      cadence: [88],
      watts: [265],
      velocity_smooth: [3.6],
      latlng: [[57.048, 9.9187]],
    })

    expect(point).toEqual({
      time: START,
      distanceMeters: 1234.5,
      altitudeMeters: 42,
      heartRateBpm: 151,
      cadenceSpm: 176,
      watts: 265,
      speedMps: 3.6,
      lat: 57.048,
      lon: 9.9187,
    })
  })
})
