// The test that actually proves the TCX trim is honest, pinned to
// fixtures/activity_23870166877.tcx (Garmin activity id 23870166877).
//
// It exports minutes 10-20 of that file and feeds the result back through the
// app's OWN read path — parseTcx -> normalizeActivity — so the assertions are
// about what a user would see after dropping the downloaded file back in.
//
// ⚠️ The cross-check that makes this worth having: the 6:10/km below is
// independently
//   - the value src/stats/statsBasis.realGarminFixture.test.js asserts for the
//     SAME window of the SAME activity, reached by zooming the parent and
//     reading the chips, and
//   - the value src/data/fit/trimFit.realGarminFixture.test.js asserts after
//     trimming the FIT export of it.
// Three independent paths — chart, FIT trim, TCX trim — agreeing on 1622.83 m
// and 6:10/km is the point of this suite, and it is invisible to a later reader
// otherwise. If one of the three moves, the trim invented or dropped something.
//
// The window is stated in terms of the fixture's OWN first <Time>, deliberately
// not `activity.startTime`, so the arithmetic does not depend on
// normalizeActivity being right about anything (trimFit.realGarminFixture's
// lines 46-51 make the same move).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { formatPace } from '../../domain/units.js'
import { parseTcx } from './parseTcx.js'
import { trimTcx } from './trimTcx.js'

const TCX_NS = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'
const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const sourceText = readFileSync(join(FIXTURE_DIR, 'activity_23870166877.tcx'), 'utf8')

const WINDOW_START_S = 600
const WINDOW_END_S = 1200

const parse = (text) => new DOMParser().parseFromString(text, 'application/xml')
const elements = (doc, localName) => Array.from(doc.getElementsByTagNameNS(TCX_NS, localName))
const textOf = (el, localName) => el.getElementsByTagNameNS(TCX_NS, localName)[0]?.textContent?.trim() ?? null

const sourceDoc = parse(sourceText)
const firstTimeText = elements(sourceDoc, 'Trackpoint')[0].getElementsByTagNameNS(TCX_NS, 'Time')[0].textContent
const firstTimeMs = new Date(firstTimeText).getTime()

const window = {
  from: new Date(firstTimeMs + WINDOW_START_S * 1000),
  to: new Date(firstTimeMs + WINDOW_END_S * 1000),
}

const trimmedText = trimTcx(sourceText, window)
const trimmedDoc = parse(trimmedText)

describe('trimTcx against the real Garmin export (fixtures/activity_23870166877.tcx)', () => {
  it('keeps exactly the trackpoints inside the window, both ends inclusive', () => {
    expect(elements(sourceDoc, 'Trackpoint')).toHaveLength(1801)
    // 601, not 600: one trackpoint per second, and both boundary seconds stay.
    expect(elements(trimmedDoc, 'Trackpoint')).toHaveLength(601)
  })

  it('re-imports through the app\'s own read path with the window\'s own totals', () => {
    const activity = normalizeActivity(parseTcx(trimmedText))

    // Within a metre: TCX writes distance as text, and the fixture's own
    // 2-decimal metres are the floor on how exactly this can agree with FIT.
    expect(activity.totalDistance).toBeCloseTo(1622.83, 0)
    expect(activity.totalTime).toBe(WINDOW_END_S - WINDOW_START_S)
    // The rebase: TCX distance is cumulative from the parent's start, so
    // without it this sample opens at ~1481 m and the total reads ~3104 m.
    expect(activity.samples[0].d).toBe(0)
  })

  it('reports the same 6:10/km the zoomed parent and the trimmed FIT both report', () => {
    const activity = normalizeActivity(parseTcx(trimmedText))
    const avgPaceSecPerKm = activity.totalMovingTime / (activity.totalDistance / 1000)
    expect(formatPace(avgPaceSecPerKm)).toBe('6:10')
  })

  it('emits one lap, with its children in the schema\'s xsd:sequence order', () => {
    const laps = elements(trimmedDoc, 'Lap')
    expect(laps).toHaveLength(1)
    // ActivityLap_t is an xsd:sequence; this is the assertion that protects
    // upload validity, and nothing else in the suite would notice it breaking.
    expect(Array.from(laps[0].children).map((child) => child.localName)).toEqual([
      'TotalTimeSeconds',
      'DistanceMeters',
      'MaximumSpeed',
      'Calories',
      'AverageHeartRateBpm',
      'MaximumHeartRateBpm',
      'Intensity',
      'TriggerMethod',
      'Track',
      'Extensions',
    ])
  })

  it('recomputes the ns3:LX values in place rather than carrying the parent\'s', () => {
    const [lapEl] = elements(trimmedDoc, 'Lap')
    const lx = lapEl.getElementsByTagNameNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'LX')[0]
    const values = Object.fromEntries(
      Array.from(lx.children).map((child) => [child.localName, Number(child.textContent)]),
    )

    // The parent's whole-activity figures are 2.618 m/s and a 101 spm peak.
    // AvgSpeed is the one that has to move — it is the window's own distance
    // over its own time, which is the same 1622.83/600 the assertions above
    // pin. (AvgRunCadence lands on the parent's 84 again; a steady run holds
    // its cadence, so that agreement is a fact about the athlete rather than a
    // sign nothing was recomputed.)
    expect(values.AvgSpeed).toBeCloseTo(1622.83 / 600, 2)
    expect(values.AvgSpeed).not.toBeCloseTo(2.618, 3)
    // A window's peak cannot exceed the whole activity's.
    expect(values.MaxRunCadence).toBeLessThanOrEqual(101)
    expect(Object.keys(values)).toEqual(['AvgSpeed', 'AvgRunCadence', 'MaxRunCadence'])
  })

  it('re-cuts the lap summary rather than carrying the parent\'s', () => {
    const [lapEl] = elements(trimmedDoc, 'Lap')

    expect(lapEl.getAttribute('StartTime')).toBe(new Date(window.from).toISOString())
    expect(Number(textOf(lapEl, 'TotalTimeSeconds'))).toBe(WINDOW_END_S - WINDOW_START_S)
    expect(Number(textOf(lapEl, 'DistanceMeters'))).toBeCloseTo(1622.83, 0)
    // The parent's 4712.21 m / 1800.18 s would be the file asserting totals its
    // own trackpoints contradict.
    expect(textOf(lapEl, 'DistanceMeters')).not.toBe('4712.21')
  })

  it('writes <Calories>0</Calories> — TCX cannot express "not measured"', () => {
    expect(textOf(elements(trimmedDoc, 'Lap')[0], 'Calories')).toBe('0')
  })

  it('re-cuts <Id> to the window, so the upload is not a duplicate of its parent', () => {
    expect(textOf(trimmedDoc.documentElement, 'Id')).toBe(new Date(window.from).toISOString())
  })

  it('keeps the XML declaration and the device that recorded it', () => {
    expect(trimmedText.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(elements(trimmedDoc, 'Creator')).toHaveLength(1)
  })

  it('carries the sport across, so the re-imported file is still a run', () => {
    const activity = normalizeActivity(parseTcx(trimmedText))
    expect(activity.sport).toBe('running')
    expect(activity.name).toBe('Morning Run')
  })
})
