// The GPX half of the export cross-check, pinned to
// fixtures/activity_23870166877.gpx — the same Garmin activity 23870166877 the
// FIT and TCX trim suites use, reduced to what GPX actually carries.
//
// ⚠️ **This suite deliberately does NOT assert 1622.83 m or 6:10/km**, unlike
// its FIT and TCX siblings. GPX carries no recorded distance at all, so
// buildDistanceAxis takes its haversine path and summing great-circle hops
// between noisy 1 Hz fixes accumulates that noise as extra distance
// (ARCHITECTURE.md §8; GpxActivitySource.realGarminFixture.test.js:46-56 pins
// the same drift for the whole activity). Asserting the device's own figure
// here would be asserting that the trim fixed a drift it has nothing to do
// with.
//
// What it asserts instead is stronger where it counts: the trimmed file's
// distance must equal the PARENT's own windowed distance **exactly**, not
// within a tolerance. Haversine is additive per segment, so summing over the
// same kept points gives an identical figure whether the cumulation starts at
// the file's first point or at the window's. Anything else means the trim
// dropped or duplicated a point — which is the only thing this module can get
// wrong about distance.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeActivity } from '../../domain/normalizeActivity.js'
import { formatPace } from '../../domain/units.js'
import { parseGpx } from './parseGpx.js'
import { trimGpx } from './trimGpx.js'

const GPX_NS = 'http://www.topografix.com/GPX/1/1'
const FIXTURE_DIR = join(process.cwd(), 'fixtures')
const sourceText = readFileSync(join(FIXTURE_DIR, 'activity_23870166877.gpx'), 'utf8')

const WINDOW_START_S = 600
const WINDOW_END_S = 1200

const parse = (text) => new DOMParser().parseFromString(text, 'application/xml')
const elements = (doc, localName) => Array.from(doc.getElementsByTagNameNS(GPX_NS, localName))

const sourceDoc = parse(sourceText)
// The window is stated in terms of the fixture's OWN first <time>, deliberately
// not `activity.startTime`, so the arithmetic does not depend on
// normalizeActivity being right about anything.
const firstTimeMs = new Date(elements(sourceDoc, 'trkpt')[0].getElementsByTagNameNS(GPX_NS, 'time')[0].textContent).getTime()

const window = {
  from: new Date(firstTimeMs + WINDOW_START_S * 1000),
  to: new Date(firstTimeMs + WINDOW_END_S * 1000),
}

const trimmedText = trimGpx(sourceText, window)
const trimmedDoc = parse(trimmedText)
const trimmed = normalizeActivity(parseGpx(trimmedText))

// The same window taken the OTHER way: zoom the parent activity and read its
// samples. This is what the stat chips describe while zoomed, and what the
// trimmed file has to agree with.
const parent = normalizeActivity(parseGpx(sourceText))
const parentWindow = parent.samples.filter((s) => s.t >= WINDOW_START_S && s.t <= WINDOW_END_S)
const parentWindowDistance = parentWindow[parentWindow.length - 1].d - parentWindow[0].d

describe('trimGpx against the real Garmin export (fixtures/activity_23870166877.gpx)', () => {
  it('keeps exactly the track points inside the window, both ends inclusive', () => {
    expect(elements(sourceDoc, 'trkpt')).toHaveLength(1801)
    // 601, not 600: one point per second, and both boundary seconds stay.
    expect(elements(trimmedDoc, 'trkpt')).toHaveLength(601)
    expect(trimmed.totalTime).toBe(WINDOW_END_S - WINDOW_START_S)
  })

  it('reports the parent\'s windowed distance EXACTLY, not merely close to it', () => {
    // Exact, not tolerant: haversine is additive per segment. 6 decimals is
    // float noise, not a measurement tolerance.
    expect(trimmed.totalDistance).toBeCloseTo(parentWindowDistance, 6)
  })

  it('reports the same average pace the zoomed parent reports for this window', () => {
    const paceOf = (distance, movingTime) => formatPace(movingTime / (distance / 1000))
    expect(paceOf(trimmed.totalDistance, trimmed.totalMovingTime)).toBe(
      paceOf(parentWindowDistance, WINDOW_END_S - WINDOW_START_S),
    )
  })

  it('inherits the haversine drift and nothing more', () => {
    // A standing measurement, not a target. FIT and TCX both read 1622.83 m for
    // this window from the device's own distance channel; reconstructing it
    // from noisy per-second fixes runs ~0.5-2% HIGH (ARCHITECTURE.md §8). The
    // trimmed file must sit exactly where its parent already sat — this pins
    // that the trim neither corrected the drift nor added to it.
    const drift = (trimmed.totalDistance - 1622.83) / 1622.83
    expect(drift).toBeGreaterThan(0.005)
    expect(drift).toBeLessThan(0.02)
  })

  it('re-cuts <metadata><time> to the first kept point and keeps the XML declaration', () => {
    expect(trimmedText.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)

    const metadataTime = elements(trimmedDoc, 'metadata')[0].getElementsByTagNameNS(GPX_NS, 'time')[0]
    expect(new Date(metadataTime.textContent).getTime()).toBe(window.from.getTime())
  })

  it('carries the sport across, so the re-imported file is still a run', () => {
    expect(trimmed.sport).toBe('running')
    // GPX carries no distance, speed, heart rate, cadence or power, so the
    // trimmed file offers exactly what its parent did — no more, no less.
    expect(trimmed.availableMetrics).toEqual(['pace', 'speed', 'altitude'])
  })
})
