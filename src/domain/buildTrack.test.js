import { describe, it, expect } from 'vitest'
import { buildTrack } from './buildTrack.js'
import { projectLatLon } from './webMercator.js'

const at = (lat, lon) => ({ time: new Date(0), lat, lon })
const noFix = (extra = {}) => ({ time: new Date(0), heartRateBpm: 140, ...extra })

describe('buildTrack', () => {
  it('projects every fix, index-aligned with the trackpoints it was given', () => {
    const track = buildTrack([at(55, 12), at(55.1, 12.1), at(55.2, 12.2)])

    expect(track.x).toHaveLength(3)
    expect(track.fixCount).toBe(3)
    expect(track.x[1]).toBeCloseTo(projectLatLon(55.1, 12.1).x, 12)
    expect(track.y[1]).toBeCloseTo(projectLatLon(55.1, 12.1).y, 12)
  })

  it('uses Float64Array, not Float32Array', () => {
    // ~2.4 m of quantisation at world scale is invisible at a full-route fit
    // and a landmine the moment anyone revisits the follow-the-window framing.
    const track = buildTrack([at(55, 12)])
    expect(track.x).toBeInstanceOf(Float64Array)
    expect(track.y).toBeInstanceOf(Float64Array)
  })

  // THE availability gate for the whole feature. A treadmill run reaches here
  // with a full set of heart-rate and cadence trackpoints and not one fix.
  it('returns null when nothing carries a fix', () => {
    expect(buildTrack([noFix(), noFix(), noFix()])).toBeNull()
  })

  it('returns null for an empty or missing array', () => {
    expect(buildTrack([])).toBeNull()
    expect(buildTrack(undefined)).toBeNull()
  })

  it('holds a slot for every trackpoint, marking the fixless ones NaN', () => {
    const track = buildTrack([at(55, 12), noFix(), at(55.2, 12.2)])

    expect(track.x).toHaveLength(3)
    expect(track.fixCount).toBe(2)
    // NaN, not 0 — 0/0 is a real place in the Gulf of Guinea, and a stroke to
    // it is the "straight line across the country" failure.
    expect(Number.isNaN(track.x[1])).toBe(true)
    expect(Number.isNaN(track.y[1])).toBe(true)
  })

  it('measures bounds over the fixes only, so one dropout cannot poison them', () => {
    const track = buildTrack([at(55, 12), noFix(), at(56, 13)])

    expect(track.bounds.x0).toBeCloseTo(projectLatLon(55, 12).x, 12)
    expect(track.bounds.x1).toBeCloseTo(projectLatLon(56, 13).x, 12)
    // y is screen-order, so the NORTHERN point is the smaller one.
    expect(track.bounds.y0).toBeCloseTo(projectLatLon(56, 13).y, 12)
    expect(track.bounds.y1).toBeCloseTo(projectLatLon(55, 12).y, 12)
  })

  // Out of range is treated as absent rather than clamped: clamping would plant
  // a plausible point at the pole and drag the whole fit out to it.
  it('treats an out-of-range or non-finite coordinate as no fix at all', () => {
    const track = buildTrack([at(55, 12), at(200, 12), at(55, 999), at(NaN, 12), at(55.1, 12.1)])

    expect(track.fixCount).toBe(2)
    expect(Number.isNaN(track.x[1])).toBe(true)
    expect(Number.isNaN(track.x[2])).toBe(true)
    expect(Number.isNaN(track.x[3])).toBe(true)
    expect(track.bounds.x1).toBeCloseTo(projectLatLon(55.1, 12.1).x, 12)
  })

  it('needs both halves of the pair', () => {
    expect(buildTrack([noFix({ lat: 55 }), noFix({ lon: 12 })])).toBeNull()
  })

  it('gives a single fix degenerate but finite bounds', () => {
    const track = buildTrack([at(55, 12)])
    expect(track.bounds.x0).toBe(track.bounds.x1)
    expect(track.bounds.y0).toBe(track.bounds.y1)
    expect(Number.isFinite(track.bounds.x0)).toBe(true)
  })
})
