import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useViewportHeight } from './useViewportHeight.js'

// jsdom lets innerHeight be assigned directly; put it back after each test so
// the suites that render ChartStack keep seeing the default 768.
const DEFAULT_INNER_HEIGHT = window.innerHeight

const resizeTo = (height) =>
  act(() => {
    window.innerHeight = height
    window.dispatchEvent(new Event('resize'))
  })

describe('useViewportHeight', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    window.innerHeight = DEFAULT_INNER_HEIGHT
  })

  it('reports the current height synchronously on first render', () => {
    // No timers involved at mount: the slot layout must be right on the very
    // first frame, not one debounce later.
    window.innerHeight = 500
    const { result } = renderHook(() => useViewportHeight())
    expect(result.current).toBe(500)
  })

  it('holds a resize back until the storm has settled', () => {
    const { result } = renderHook(() => useViewportHeight())
    expect(result.current).toBe(DEFAULT_INNER_HEIGHT)

    resizeTo(600)
    // Mid-drag: still the old height — every raw event re-rendering every
    // Recharts panel is exactly what the debounce is for.
    expect(result.current).toBe(DEFAULT_INNER_HEIGHT)

    act(() => vi.advanceTimersByTime(150))
    expect(result.current).toBe(600)
  })

  it('reports only the final height of a burst of resizes', () => {
    const { result } = renderHook(() => useViewportHeight())

    for (const height of [700, 650, 600, 550]) {
      resizeTo(height)
      act(() => vi.advanceTimersByTime(100)) // inside the previous window
    }
    expect(result.current).toBe(DEFAULT_INNER_HEIGHT)

    act(() => vi.advanceTimersByTime(150))
    expect(result.current).toBe(550)
  })

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useViewportHeight())
    unmount()
    resizeTo(320)
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toBe(DEFAULT_INNER_HEIGHT)
  })
})
