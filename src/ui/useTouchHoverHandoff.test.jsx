// Recharts-free coverage of the handoff mechanism itself: the hook's whole job
// is "dispatch a bubbling mouseout at the right wrappers and nowhere else", and
// that is observable with two plain divs and a spy. The end-to-end proof — that
// a real Recharts panel actually un-freezes — lives in ChartStack.test.jsx.
//
// jsdom 30 has no Touch constructor (the reason the pinch gesture is built on
// Pointer events), but fireEvent.touchStart accepts plain objects in `touches`,
// and this handler only ever reads `e.touches.length` and `e.target`.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useTouchHoverHandoff } from './useTouchHoverHandoff.js'

function Stack({ mounted = true }) {
  const ref = useTouchHoverHandoff()
  if (!mounted) return null
  return (
    <div className="chart-stack" ref={ref}>
      <div className="recharts-wrapper" data-testid="a">
        <svg data-testid="a-svg" />
      </div>
      <div className="recharts-wrapper" data-testid="b">
        <svg data-testid="b-svg" />
      </div>
    </div>
  )
}

/** Spies on each wrapper, returning how many mouseouts each one saw. */
function spyOnWrappers(container) {
  const spies = [...container.querySelectorAll('.recharts-wrapper')].map((wrapper) => {
    const spy = vi.fn()
    wrapper.addEventListener('mouseout', spy)
    return spy
  })
  return () => spies.map((spy) => spy.mock.calls.length)
}

const oneFinger = { touches: [{ clientX: 0, clientY: 0 }] }
const twoFingers = { touches: [{ clientX: 0, clientY: 0 }, { clientX: 40, clientY: 0 }] }

describe('useTouchHoverHandoff', () => {
  it('leaves every other panel when one is touched, and not the touched one', () => {
    const { container, getByTestId } = render(<Stack />)
    const counts = spyOnWrappers(container)

    fireEvent.touchStart(getByTestId('b'), oneFinger)

    expect(counts()).toEqual([1, 0])
  })

  it('finds the wrapper from a touch that lands on a descendant, not the wrapper itself', () => {
    // The real target is always some element inside the SVG, never the wrapper
    // div — which is why the guard is `contains`, not `===`.
    const { container, getByTestId } = render(<Stack />)
    const counts = spyOnWrappers(container)

    fireEvent.touchStart(getByTestId('a-svg'), oneFinger)

    expect(counts()).toEqual([0, 1])
  })

  it('dispatches a bubbling mouseout whose relatedTarget is the stack', () => {
    // Both halves are load-bearing for React's EnterLeave plugin: without
    // bubbles it never reaches the delegated root listener, and without a
    // relatedTarget inside the stack the leave would propagate past it.
    const { container, getByTestId } = render(<Stack />)
    const stack = container.querySelector('.chart-stack')
    const spy = vi.fn()
    getByTestId('a').addEventListener('mouseout', spy)

    fireEvent.touchStart(getByTestId('b'), oneFinger)

    const event = spy.mock.calls[0][0]
    expect(event.bubbles).toBe(true)
    expect(event.relatedTarget).toBe(stack)
  })

  it('ignores a two-finger touch, which is a pinch owned by usePinchZoom', () => {
    const { container, getByTestId } = render(<Stack />)
    const counts = spyOnWrappers(container)

    fireEvent.touchStart(getByTestId('b'), twoFingers)

    expect(counts()).toEqual([0, 0])
  })

  it('is harmless when the same panel is touched twice in a row', () => {
    const { container, getByTestId } = render(<Stack />)
    const counts = spyOnWrappers(container)

    fireEvent.touchStart(getByTestId('b'), oneFinger)
    fireEvent.touchStart(getByTestId('b'), oneFinger)

    // The touched panel keeps its own hover both times: a tap that never moves
    // must not clear the readout it just placed.
    expect(counts()).toEqual([2, 0])
  })

  it('removes its listener when the node detaches', () => {
    const { container, getByTestId, rerender } = render(<Stack />)
    const wrapperA = getByTestId('a')
    const wrapperB = getByTestId('b')
    const stack = container.querySelector('.chart-stack')
    const spy = vi.fn()
    wrapperA.addEventListener('mouseout', spy)

    rerender(<Stack mounted={false} />)
    // The detached subtree still exists in memory, so a stray touch on it would
    // still reach a listener that was never cleaned up.
    fireEvent.touchStart(wrapperB, oneFinger)

    expect(spy).not.toHaveBeenCalled()
    expect(stack.isConnected).toBe(false)
  })
})
