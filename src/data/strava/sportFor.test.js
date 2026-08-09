import { describe, it, expect } from 'vitest'
import { humanizeSportType, sportFor } from './sportFor.js'

describe('sportFor', () => {
  it.each([
    ['Run', 'running'],
    ['TrailRun', 'running'],
    ['VirtualRun', 'running'],
    ['Walk', 'running'],
    ['Hike', 'running'],
    ['Ride', 'cycling'],
    ['MountainBikeRide', 'cycling'],
    ['GravelRide', 'cycling'],
    ['EBikeRide', 'cycling'],
    ['VirtualRide', 'cycling'],
    ['Handcycle', 'cycling'],
  ])('maps %s to %s', (sportType, sport) => {
    expect(sportFor(sportType)).toBe(sport)
  })

  // `track` is "a generic GPS log with no sport of its own", and
  // metricRegistry gives it every metric except pace — so a Swim charts as
  // speed + HR + altitude, which is correct. Strava adds sport types faster
  // than this table can track them; a new one must not break the picker.
  it.each(['Swim', 'Rowing', 'Windsurf', 'AlpineSki', 'SomethingStravaAddedLastWeek'])(
    'falls back to track for %s, without throwing',
    (sportType) => {
      expect(sportFor(sportType)).toBe('track')
    },
  )

  it('falls back to track for a missing or non-string value', () => {
    expect(sportFor(undefined)).toBe('track')
    expect(sportFor(null)).toBe('track')
    expect(sportFor(42)).toBe('track')
  })

  // One value travels from the row to the ref, so the humanized label the
  // athlete reads and the key this table looks up cannot disagree.
  it('accepts the humanized spelling as well as the wire one', () => {
    expect(sportFor('Trail Run')).toBe('running')
    expect(sportFor('Mountain Bike Ride')).toBe('cycling')
    expect(sportFor('E Bike Ride')).toBe('cycling')
  })
})

describe('humanizeSportType', () => {
  it.each([
    ['Run', 'Run'],
    ['TrailRun', 'Trail Run'],
    ['VirtualRide', 'Virtual Ride'],
    ['MountainBikeRide', 'Mountain Bike Ride'],
    // Runs of capitals split correctly, rather than producing "EBike Ride".
    ['EBikeRide', 'E Bike Ride'],
  ])('%s -> %s', (sportType, label) => {
    expect(humanizeSportType(sportType)).toBe(label)
  })

  it('is null for a missing value, so the row renders no sport rather than "undefined"', () => {
    expect(humanizeSportType(undefined)).toBeNull()
    expect(humanizeSportType('')).toBeNull()
    expect(humanizeSportType(null)).toBeNull()
  })
})
