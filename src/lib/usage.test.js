import { afterEach, describe, expect, it, vi } from 'vitest'
import { USAGE_API_PATH } from '../../shared/usageEvents.js'
import { flushUsage, hasOptedOut, installUsageBeacon, markUsed, resetUsageForTests } from './usage.js'

function fakeNav(overrides = {}) {
  const beacons = []
  return {
    beacons,
    sendBeacon: vi.fn((url, blob) => {
      beacons.push({ url, blob })
      return true
    }),
    ...overrides,
  }
}

async function bodyOf(beacon) {
  return JSON.parse(await beacon.blob.text())
}

afterEach(() => resetUsageForTests())

describe('usage flags', () => {
  it('sends nothing when nothing was used', () => {
    const nav = fakeNav()
    expect(flushUsage({ nav })).toEqual([])
    expect(nav.sendBeacon).not.toHaveBeenCalled()
  })

  it('sends each used feature once, sorted, with no other field', async () => {
    const nav = fakeNav()
    markUsed('zoom')
    markUsed('load:file')
    markUsed('zoom')

    expect(flushUsage({ nav })).toEqual(['load:file', 'zoom'])
    expect(nav.beacons).toHaveLength(1)
    expect(nav.beacons[0].url).toBe(USAGE_API_PATH)
    // The whole wire format. Anything added here is a privacy decision and
    // has to go through doc/USAGE_ANALYTICS.md and /about first.
    expect(await bodyOf(nav.beacons[0])).toEqual({ v: 1, f: ['load:file', 'zoom'] })
  })

  it('sends only what is new on a later flush, and nothing if nothing is', async () => {
    const nav = fakeNav()
    markUsed('zoom')
    flushUsage({ nav })
    expect(flushUsage({ nav })).toEqual([])

    markUsed('zoom')
    markUsed('export')
    flushUsage({ nav })
    expect(nav.beacons).toHaveLength(2)
    expect(await bodyOf(nav.beacons[1])).toEqual({ v: 1, f: ['export'] })
  })

  it('keeps features pending when the browser refuses to queue the beacon', () => {
    const nav = fakeNav({ sendBeacon: vi.fn(() => false) })
    markUsed('share')
    expect(flushUsage({ nav })).toEqual([])
    nav.sendBeacon = vi.fn(() => true)
    expect(flushUsage({ nav })).toEqual(['share'])
  })

  it('ignores ids outside the allowlist', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const nav = fakeNav()
    markUsed('filename:my-run.fit')
    expect(flushUsage({ nav })).toEqual([])
    warn.mockRestore()
  })

  it.each([
    ['Global Privacy Control', { globalPrivacyControl: true }],
    ['Do Not Track', { doNotTrack: '1' }],
  ])('never sends anything under %s', (_, signal) => {
    const nav = fakeNav(signal)
    expect(hasOptedOut(nav)).toBe(true)
    markUsed('zoom')
    expect(flushUsage({ nav })).toEqual([])
    expect(nav.sendBeacon).not.toHaveBeenCalled()
  })

  it('flushes when the page is hidden or left, and only then', () => {
    const nav = fakeNav()
    const uninstall = installUsageBeacon({ nav })
    try {
      markUsed('load:file')
      expect(nav.sendBeacon).not.toHaveBeenCalled()

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(nav.sendBeacon).toHaveBeenCalledTimes(1)

      // pagehide right after the same exit is a no-op: nothing new was used.
      window.dispatchEvent(new Event('pagehide'))
      expect(nav.sendBeacon).toHaveBeenCalledTimes(1)
    } finally {
      uninstall()
      delete document.visibilityState
    }
  })
})
