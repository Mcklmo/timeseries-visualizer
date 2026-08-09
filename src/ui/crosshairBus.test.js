import { describe, it, expect, afterEach, vi } from 'vitest'
import { currentCrosshair, publishCrosshair, resetCrosshairBus, subscribeCrosshair } from './crosshairBus.js'

afterEach(() => resetCrosshairBus())

describe('crosshairBus', () => {
  it('delivers a published position to every subscriber', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribeCrosshair(a)
    subscribeCrosshair(b)

    publishCrosshair({ t: 12, d: 340 })

    expect(a).toHaveBeenLastCalledWith({ t: 12, d: 340 })
    expect(b).toHaveBeenLastCalledWith({ t: 12, d: 340 })
  })

  // A panel mounting mid-hover — toggling a metric on, or the map itself being
  // switched on — would otherwise draw nothing until the next pointer move.
  it('replays the current position to a late subscriber, immediately', () => {
    publishCrosshair({ t: 5, d: 20 })

    const late = vi.fn()
    subscribeCrosshair(late)

    expect(late).toHaveBeenCalledTimes(1)
    expect(late).toHaveBeenCalledWith({ t: 5, d: 20 })
  })

  it('replays null when nothing has been published', () => {
    const fn = vi.fn()
    subscribeCrosshair(fn)
    expect(fn).toHaveBeenCalledWith(null)
  })

  it('publishes null as the "no crosshair" signal', () => {
    const fn = vi.fn()
    subscribeCrosshair(fn)
    publishCrosshair({ t: 1, d: 2 })
    publishCrosshair(null)

    expect(fn).toHaveBeenLastCalledWith(null)
    expect(currentCrosshair()).toBeNull()
  })

  it('stops delivering after unsubscribe', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeCrosshair(fn)
    unsubscribe()
    publishCrosshair({ t: 1, d: 2 })

    expect(fn).toHaveBeenCalledTimes(1) // the replay at subscribe, and nothing since
  })

  // The publisher is called from inside a React effect during a live gesture;
  // a throw there would take the hover pipeline down with it.
  it('isolates a throwing subscriber from the others and from the publisher', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      subscribeCrosshair(() => {
        throw new Error('boom')
      })
      const healthy = vi.fn()
      subscribeCrosshair(healthy)

      expect(() => publishCrosshair({ t: 9, d: 9 })).not.toThrow()
      expect(healthy).toHaveBeenLastCalledWith({ t: 9, d: 9 })
    } finally {
      spy.mockRestore()
    }
  })
})
