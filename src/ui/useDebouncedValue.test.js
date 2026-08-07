import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue.js'

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const advance = (ms) => act(() => vi.advanceTimersByTime(ms))

  it('reports the initial value immediately, with nothing to wait for', () => {
    const { result } = renderHook(() => useDebouncedValue('run', 300))
    expect(result.current).toBe('run')
  })

  it('holds a change back until the delay has fully elapsed', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'run' },
    })

    rerender({ value: 'runn' })
    advance(299)
    expect(result.current).toBe('run')

    advance(1)
    expect(result.current).toBe('runn')
  })

  // The property the search box actually depends on: a burst of keystrokes is
  // one update, not one per character, because each change restarts the wait.
  it('restarts the wait on every change, so a burst settles once', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 't' },
    })

    for (const value of ['te', 'tem', 'temp', 'tempo']) {
      rerender({ value })
      advance(200) // each one lands inside the previous timer's window
    }
    expect(result.current).toBe('t')

    advance(300)
    expect(result.current).toBe('tempo')
  })

  it('drops the pending update when the value returns to what was already reported', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'run' },
    })

    rerender({ value: 'runn' })
    advance(100)
    rerender({ value: 'run' })
    advance(300)

    expect(result.current).toBe('run')
  })
})
