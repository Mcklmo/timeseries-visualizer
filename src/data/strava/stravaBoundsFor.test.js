import { afterEach, describe, it, expect } from 'vitest'
import { stravaBoundsFor } from './stravaBoundsFor.js'

const FALLBACK = '2026-01-01'

/** The epoch seconds of local midnight on `day`, computed independently of the
 *  module under test so the assertions are not a restatement of it. */
const localMidnight = (y, m, d) => Math.floor(new Date(y, m - 1, d).getTime() / 1000)

describe('stravaBoundsFor', () => {
  it('sends the range start as epoch seconds, a second before local midnight', () => {
    const { after } = stravaBoundsFor({ from: '2026-03-01', to: null }, FALLBACK)
    // A second early because Strava treats `after` as strictly-after: without
    // it, an activity started at exactly 00:00:00 would be excluded from a
    // range that names its day.
    expect(after).toBe(localMidnight(2026, 3, 1) - 1)
  })

  // The inclusive-end trap, in a different unit. `before` is exclusive, so an
  // inclusive `to` has to be sent as midnight at the start of the NEXT day —
  // otherwise a range ending today returns nothing recorded today.
  it('sends the inclusive range end as the following local midnight', () => {
    const { before } = stravaBoundsFor({ from: '2026-03-01', to: '2026-03-31' }, FALLBACK)
    expect(before).toBe(localMidnight(2026, 4, 1))
  })

  it.each([
    ['a month boundary', '2026-01-31', [2026, 2, 1]],
    ['a year boundary', '2026-12-31', [2027, 1, 1]],
    ['a leap day', '2028-02-29', [2028, 3, 1]],
  ])('rolls %s over correctly', (_label, to, [y, m, d]) => {
    expect(stravaBoundsFor({ from: '2020-01-01', to }, FALLBACK).before).toBe(localMidnight(y, m, d))
  })

  it('omits `before` entirely when the range has no end, restoring "up to now"', () => {
    const bounds = stravaBoundsFor({ from: '2026-03-01', to: null }, FALLBACK)
    expect('before' in bounds).toBe(false)
  })

  it('uses the fallback when the athlete emptied the From field by hand', () => {
    const { after } = stravaBoundsFor({ from: null, to: null }, FALLBACK)
    expect(after).toBe(localMidnight(2026, 1, 1) - 1)
  })

  it('handles a one-day range containing a whole day', () => {
    const { after, before } = stravaBoundsFor({ from: '2026-03-15', to: '2026-03-15' }, FALLBACK)
    expect(before - after).toBe(24 * 60 * 60 + 1)
  })
})

// The athlete typed a day into a date field while looking at their own
// calendar. Their 1 March is their 1 March — `new Date('2026-03-01')` is
// parsed as UTC per spec and lands on the previous evening west of Greenwich.
describe('the bounds are local-calendar, not UTC', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it.each(['Asia/Tokyo', 'America/Denver'])('anchors on local midnight in %s', (timeZone) => {
    process.env.TZ = timeZone

    const { after } = stravaBoundsFor({ from: '2026-03-01', to: null }, FALLBACK)
    const asUtcMidnight = Math.floor(Date.parse('2026-03-01T00:00:00Z') / 1000)

    expect(after).toBe(localMidnight(2026, 3, 1) - 1)
    // The guard that the zone switch really took: without it this test could
    // pass vacuously on a machine that happens to run in UTC.
    expect(after).not.toBe(asUtcMidnight - 1)
  })
})
