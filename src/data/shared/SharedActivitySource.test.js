import { describe, expect, it } from 'vitest'
import { SharedActivitySource } from './SharedActivitySource.js'
import { SHARE_MESSAGES, encodeActivityToPayload } from './shareCodec.js'

/** The smallest Activity the encoder accepts — enough for adapter plumbing. */
function tinyActivity(name = 'Evening Run') {
  return {
    id: 'tiny',
    sport: 'running',
    name,
    startTime: new Date('2026-08-01T07:00:00Z'),
    totalTime: 9,
    totalMovingTime: 9,
    totalDistance: 30,
    samples: Array.from({ length: 10 }, (_, i) => ({
      t: i,
      d: i * 3.3,
      heartRate: 150 + i,
      moving: true,
    })),
    samplingIntervalS: 1,
    availableMetrics: ['heartRate'],
    track: null,
  }
}

describe('SharedActivitySource', () => {
  it('loads a decoded payload through the normal pipeline', async () => {
    const payload = await encodeActivityToPayload(tinyActivity())
    const activity = await new SharedActivitySource().load({ type: 'shared', payload })

    expect(activity.sport).toBe('running')
    expect(activity.samples).toHaveLength(10)
    expect(activity.availableMetrics).toContain('heartRate')
    expect(activity.totalDistance).toBeCloseTo(9 * 3.3, 1)
    // Re-derived, not decoded — the pipeline is shared with every adapter.
    expect(activity.id).toBeTruthy()
    expect(activity.track).toBeNull()
  })

  it('the payload name wins over the derived one', async () => {
    const payload = await encodeActivityToPayload(tinyActivity('Tempo 5×1k'))
    const activity = await new SharedActivitySource().load({ type: 'shared', payload })
    expect(activity.name).toBe('Tempo 5×1k')
  })

  it('rejects the wrong ref type', async () => {
    await expect(
      new SharedActivitySource().load({ type: 'file', file: new File(['x'], 'x.tcx') }),
    ).rejects.toThrow(/shared reference/)
  })

  it('surfaces a malformed payload as the damaged-link error', async () => {
    await expect(new SharedActivitySource().load({ type: 'shared', payload: '1junk' })).rejects.toThrow(
      SHARE_MESSAGES.damaged,
    )
  })
})
