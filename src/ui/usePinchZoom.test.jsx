import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { fullDomain, minSpanFor, pinchDomain, valueAtFraction } from '../domain/zoomDomain.js'
import { usePinchZoom } from './usePinchZoom.js'

// Driven through a bare harness rather than through ChartStack on purpose: an
// onZoomChange spy shows the emitted domain exactly, instead of reverse-
// engineering it out of an SVG path, and it sidesteps ResponsiveContainer's
// async measurement entirely. ChartStack.test.jsx covers the wiring into the
// real chart; this file covers the gesture.
function Harness({ onZoomChange, domain = fullDomain(), fullExtent = [0, 100] }) {
  const { ref, wheelHint } = usePinchZoom({ domain, fullExtent, onZoomChange })
  return (
    <div ref={ref} data-testid="stack">
      {/* What plotRectOf measures. setupTests.js returns the same fixed
          {left:0, width:800} rect for every element, so this stands in for a
          real Recharts <svg>. */}
      <svg className="recharts-surface" />
      {wheelHint ? <p data-testid="hint">Use Ctrl + scroll to zoom</p> : null}
    </div>
  )
}

// Under the global rect stub the plot area is {left: 60, width: 728}, and
// 728 = 8 × 91 — so eighth-fractions land on integer clientX values.
const X = { f0: 60, f125: 151, f25: 242, f50: 424, f75: 606, f875: 697, f100: 788 }

function touch(clientX, pointerId) {
  return { pointerId, pointerType: 'touch', clientX, clientY: 100 }
}

function wheelEvent({
  deltaY,
  deltaX = 0,
  deltaMode = 0,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
  clientX = X.f50,
}) {
  return new WheelEvent('wheel', {
    deltaY,
    deltaX,
    deltaMode,
    ctrlKey,
    metaKey,
    shiftKey,
    clientX,
    cancelable: true,
    bubbles: true,
  })
}

// jsdom 30 has no Touch constructor (it does have TouchEvent), and the guard
// only ever reads `touches.length` — so a plain Event carrying a `touches`
// array exercises exactly the path that matters.
function multiTouchEvent(type, count) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  event.touches = Array.from({ length: count }, () => ({}))
  return event
}

// Emission is rAF-coalesced, so every assertion has to wait a frame. Matches
// the idiom already used in ChartStack.test.jsx.
function nextFrame() {
  return act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

async function pinch(el, { from, to }) {
  fireEvent.pointerDown(el, touch(from[0], 1))
  fireEvent.pointerDown(el, touch(from[1], 2))
  fireEvent.pointerMove(window, touch(to[0], 1))
  fireEvent.pointerMove(window, touch(to[1], 2))
  await nextFrame()
}

function renderHarness(props = {}) {
  const onZoomChange = vi.fn()
  const utils = render(<Harness onZoomChange={onZoomChange} {...props} />)
  return { ...utils, onZoomChange, stack: utils.getByTestId('stack') }
}

describe('usePinchZoom — two-finger pinch', () => {
  it('emits the domain the pure solve predicts for the same two fingers', async () => {
    const { stack, onZoomChange } = renderHarness()

    await pinch(stack, { from: [X.f25, X.f75], to: [X.f125, X.f875] })

    // Computed independently from the pure module, so this asserts the WIRING
    // (which pixels became which fractions) rather than re-deriving the math.
    const expected = pinchDomain({ value: 25, fraction: 0.125 }, { value: 75, fraction: 0.875 }, [0, 100])
    expect(onZoomChange).toHaveBeenCalledTimes(1)
    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[0]).toBeCloseTo(expected[0], 6)
    expect(emitted[1]).toBeCloseTo(expected[1], 6)
    expect(emitted[1] - emitted[0]).toBeLessThan(100) // narrower than full
  })

  it('keeps both anchored values under both fingers', async () => {
    const { stack, onZoomChange } = renderHarness()

    await pinch(stack, { from: [X.f25, X.f75], to: [X.f125, X.f875] })

    const emitted = onZoomChange.mock.calls[0][0]
    expect(valueAtFraction(0.125, emitted)).toBeCloseTo(25, 6)
    expect(valueAtFraction(0.875, emitted)).toBeCloseTo(75, 6)
  })

  // Pan is not a separate gesture and was never built as one — it is what the
  // anchored solve already does when both fingers move together. Asserted at
  // the wiring level as well as in zoomDomain.test.js so nobody removes it
  // from either end.
  it('pans for free: moving both fingers together shifts the window at constant width', async () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    const shift = 91 // exactly an eighth of the plot
    await pinch(stack, { from: [X.f25, X.f75], to: [X.f25 + shift, X.f75 + shift] })

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[1] - emitted[0]).toBeCloseTo(40, 6)
    expect(emitted[0]).toBeCloseTo(15, 6)
  })

  it('does nothing for a single finger — one-finger drag stays page scroll', async () => {
    const { stack, onZoomChange } = renderHarness()

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerMove(window, touch(X.f75, 1))
    await nextFrame()

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('ignores mouse pointers, leaving Recharts hover untouched', async () => {
    const { stack, onZoomChange } = renderHarness()

    fireEvent.pointerDown(stack, { pointerId: 1, pointerType: 'mouse', clientX: X.f25 })
    fireEvent.pointerDown(stack, { pointerId: 2, pointerType: 'mouse', clientX: X.f75 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: X.f125 })
    await nextFrame()

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('disarms while a third finger is down', async () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerDown(stack, touch(X.f75, 2))
    fireEvent.pointerDown(stack, touch(X.f50, 3))
    fireEvent.pointerMove(window, touch(X.f125, 1))
    await nextFrame()

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('re-arms with FRESH anchors when the third finger lifts, so the chart does not jump', async () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerDown(stack, touch(X.f75, 2))
    fireEvent.pointerDown(stack, touch(X.f50, 3))
    fireEvent.pointerMove(window, touch(X.f125, 1)) // moved while disarmed
    fireEvent.pointerUp(window, touch(X.f50, 3))

    // Back to two fingers, neither of which has moved since the re-arm: the
    // window must be exactly what it already was. If the stale anchors (25/75
    // captured at 0.25/0.75) survived, finger 1's move to 0.125 would land a
    // different domain here and the chart would visibly jump.
    fireEvent.pointerMove(window, touch(X.f125, 1))
    await nextFrame()
    expect(onZoomChange).not.toHaveBeenCalled()

    // Now move for real. Fresh anchors are 25 @ 0.125 and 50 @ 0.75; dragging
    // finger 1 out to the left edge gives width (50-25)/0.75 and start 25.
    fireEvent.pointerMove(window, touch(X.f0, 1))
    await nextFrame()

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[0]).toBeCloseTo(25, 6)
    expect(emitted[1] - emitted[0]).toBeCloseTo(25 / 0.75, 6)
  })

  it('stops emitting once the fingers are lifted', async () => {
    const { stack, onZoomChange } = renderHarness()

    await pinch(stack, { from: [X.f25, X.f75], to: [X.f125, X.f875] })
    const callsDuringGesture = onZoomChange.mock.calls.length

    fireEvent.pointerUp(window, touch(X.f125, 1))
    fireEvent.pointerUp(window, touch(X.f875, 2))
    fireEvent.pointerMove(window, touch(X.f50, 1))
    fireEvent.pointerMove(window, touch(X.f75, 2))
    await nextFrame()

    expect(onZoomChange).toHaveBeenCalledTimes(callsDuringGesture)
  })

  it('stops emitting after pointercancel, which is what iOS sends when it takes the gesture', async () => {
    const { stack, onZoomChange } = renderHarness()

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerDown(stack, touch(X.f75, 2))
    fireEvent.pointerCancel(window, touch(X.f25, 1))
    fireEvent.pointerMove(window, touch(X.f125, 1))
    fireEvent.pointerMove(window, touch(X.f875, 2))
    await nextFrame()

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('holds the last good domain when the fingers cross, rather than inverting the chart', async () => {
    const { stack, onZoomChange } = renderHarness()

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerDown(stack, touch(X.f75, 2))
    // Swap sides: the left finger ends up right of the right one.
    fireEvent.pointerMove(window, touch(X.f875, 1))
    fireEvent.pointerMove(window, touch(X.f125, 2))
    await nextFrame()

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('refuses to zoom from fingers closer together than the 16px floor', async () => {
    const { stack, onZoomChange } = renderHarness()

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerDown(stack, touch(X.f75, 2))
    fireEvent.pointerMove(window, touch(400, 1))
    fireEvent.pointerMove(window, touch(410, 2))
    await nextFrame()

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('coalesces a burst of moves into one emission per frame', async () => {
    const { stack, onZoomChange } = renderHarness()

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerDown(stack, touch(X.f75, 2))
    // A ProMotion screen delivers these at up to 120Hz, and each emission
    // re-renders every panel — so only the newest position may survive.
    for (let x = X.f25; x >= X.f125; x -= 5) {
      fireEvent.pointerMove(window, touch(x, 1))
    }
    await nextFrame()

    expect(onZoomChange).toHaveBeenCalledTimes(1)
  })

  it('never zooms past the max-zoom floor, however hard the fingers spread', async () => {
    const { stack, onZoomChange } = renderHarness()

    fireEvent.pointerDown(stack, touch(423, 1))
    fireEvent.pointerDown(stack, touch(425, 2))
    fireEvent.pointerMove(window, touch(X.f0, 1))
    fireEvent.pointerMove(window, touch(X.f100, 2))
    await nextFrame()

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[1] - emitted[0]).toBeCloseTo(minSpanFor(100), 6)
  })
})

describe('usePinchZoom — desktop wheel', () => {
  it('zooms on ctrl + wheel and prevents the browser page zoom', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    const event = wheelEvent({ deltaY: -50, ctrlKey: true })
    fireEvent(stack, event)

    expect(onZoomChange).toHaveBeenCalledTimes(1)
    expect(onZoomChange.mock.calls[0][0][1] - onZoomChange.mock.calls[0][0][0]).toBeLessThan(40)
    expect(event.defaultPrevented).toBe(true)
  })

  it('zooms on ⌘ + wheel too, so a Mac trackpad pinch works either way', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: -50, metaKey: true }))

    expect(onZoomChange).toHaveBeenCalledTimes(1)
  })

  it('zooms out on a positive ctrl + wheel delta', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [40, 60] })

    fireEvent(stack, wheelEvent({ deltaY: 50, ctrlKey: true }))

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[1] - emitted[0]).toBeGreaterThan(20)
  })

  it('anchors the zoom under the cursor, not at the plot centre', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [0, 100] })

    fireEvent(stack, wheelEvent({ deltaY: -50, ctrlKey: true, clientX: X.f0 }))

    // Cursor at the far left edge: that value stays put and the window
    // shrinks in from the right.
    expect(onZoomChange.mock.calls[0][0][0]).toBeCloseTo(0, 6)
  })

  it('normalises Firefox line-mode deltas instead of treating deltaY:3 as nothing', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: -3, deltaMode: 1, ctrlKey: true }))

    // 3 lines × 16px = 48px of intent — a visible zoom, not a rounding error.
    const emitted = onZoomChange.mock.calls[0][0]
    expect(40 - (emitted[1] - emitted[0])).toBeGreaterThan(1)
  })

  it('clamps one violent flick, so a single event cannot jump from full to max zoom', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [0, 100] })

    fireEvent(stack, wheelEvent({ deltaY: -100000, ctrlKey: true }))

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[1] - emitted[0]).toBeCloseTo(50, 6) // halved, not annihilated
  })

  it('leaves a plain wheel to scroll the page, and shows the hint', () => {
    const { stack, onZoomChange, queryByTestId } = renderHarness()

    const event = wheelEvent({ deltaY: 50 })
    fireEvent(stack, event)

    expect(onZoomChange).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(queryByTestId('hint')).toBeInTheDocument()
  })

  it('shows the hint once per session, not on every scroll past the charts', () => {
    // Fake timers only here: the point of this test is what happens AFTER the
    // hint's own 1.5s timeout, which is the one thing in this file that isn't
    // rAF-paced.
    vi.useFakeTimers()
    try {
      const { stack, queryByTestId } = renderHarness()

      fireEvent(stack, wheelEvent({ deltaY: 50 }))
      expect(queryByTestId('hint')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(2000))
      expect(queryByTestId('hint')).not.toBeInTheDocument()

      // The charts fill the viewport, so an ordinary read-through scrolls past
      // them repeatedly — the hint must not come back for each one.
      fireEvent(stack, wheelEvent({ deltaY: 50 }))
      expect(queryByTestId('hint')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never hints once the user has successfully zoomed — they already know', () => {
    const { stack, queryByTestId } = renderHarness({ domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: -50, ctrlKey: true }))
    fireEvent(stack, wheelEvent({ deltaY: 50 }))

    expect(queryByTestId('hint')).not.toBeInTheDocument()
  })
})

// The wheel path is not rAF-coalesced (only the pinch path is), so every
// assertion below is synchronous — no nextFrame().
describe('usePinchZoom — trackpad pan', () => {
  it('slides the zoomed window by exactly the swipe distance as a fraction of the plot', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    // 91px of the 728px plot is exactly an eighth; an eighth of the 40-wide
    // window is 5. Positive deltaX moves the window forward, like a scrollbar.
    const event = wheelEvent({ deltaY: 0, deltaX: 91 })
    fireEvent(stack, event)

    expect(onZoomChange).toHaveBeenCalledTimes(1)
    expect(onZoomChange.mock.calls[0][0]).toEqual([25, 65])
    expect(event.defaultPrevented).toBe(true)
  })

  it('pans backward on a negative deltaX', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: -91 }))

    expect(onZoomChange.mock.calls[0][0]).toEqual([15, 55])
  })

  it('keeps the width bit-identical even at a deep zoom', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [30, 31] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 91 }))

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[1] - emitted[0]).toBe(1)
  })

  it('ignores a vertical-dominant wheel, so an ordinary read-through does not jitter the window sideways', () => {
    const { stack, onZoomChange, queryByTestId } = renderHarness({ domain: [20, 60] })

    // A macOS two-finger scroll is always slightly diagonal — panning on any
    // deltaX at all would make reading down the page drag the chart.
    const event = wheelEvent({ deltaY: 50, deltaX: 5 })
    fireEvent(stack, event)

    expect(onZoomChange).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(queryByTestId('hint')).toBeInTheDocument()
  })

  it('does not pan while unzoomed, and leaves the swipe to the browser', () => {
    // There is nowhere to pan to with the whole activity on screen, and
    // swallowing the gesture there would break nothing visibly while stopping
    // whatever the browser wanted to do with it.
    const { stack, onZoomChange } = renderHarness()

    const event = wheelEvent({ deltaY: 0, deltaX: 91 })
    fireEvent(stack, event)

    expect(onZoomChange).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('pans on Shift + vertical wheel, the Firefox shape of a horizontal scroll', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    // Chrome swaps the axis itself under Shift and would send this as deltaX;
    // Firefox leaves it in deltaY. Both must pan.
    fireEvent(stack, wheelEvent({ deltaY: 91, shiftKey: true }))

    expect(onZoomChange.mock.calls[0][0]).toEqual([25, 65])
  })

  it('normalises a line-mode horizontal delta, just like the zoom path does', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    // 3 lines × 16px = 48px sideways — Firefox's units are just as real on
    // this axis as on the other one.
    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 3, deltaMode: 1 }))

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[0]).toBeCloseTo(20 + (48 / 728) * 40, 9)
  })

  it('still zooms on ctrl + a diagonal scroll, rather than panning it', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: -50, deltaX: -100, ctrlKey: true }))

    // A pan preserves width exactly, so a narrower window proves the ctrl test
    // ran first and the zoom path took the event.
    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[1] - emitted[0]).toBeLessThan(40)
  })

  it('stops dead at the end of the activity instead of running off it', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [50, 90] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 728 })) // a full plot width

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted).toEqual([60, 100])
    expect(emitted[1] - emitted[0]).toBe(40)
  })
})

describe('usePinchZoom — multi-touch guard', () => {
  it('swallows a two-finger touchstart so Recharts tooltip handlers never see it', () => {
    const { stack } = renderHarness()

    const event = multiTouchEvent('touchstart', 2)
    fireEvent(stack, event)

    // preventDefault is what suppresses iOS Safari's own page zoom, and doing
    // it on touchstart rather than only touchmove is the load-bearing half:
    // once the UA commits to a scroll it fires touchcancel and a late
    // preventDefault is ignored.
    expect(event.defaultPrevented).toBe(true)
  })

  it('swallows a two-finger touchmove as well', () => {
    const { stack } = renderHarness()

    const event = multiTouchEvent('touchmove', 2)
    fireEvent(stack, event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('lets a single touch through, so tap-to-read still works', () => {
    const { stack } = renderHarness()

    const event = multiTouchEvent('touchmove', 1)
    fireEvent(stack, event)

    expect(event.defaultPrevented).toBe(false)
  })
})

describe('usePinchZoom — safety', () => {
  it('does nothing at all without an extent (no activity loaded yet)', async () => {
    const { stack, onZoomChange } = renderHarness({ fullExtent: null })

    await pinch(stack, { from: [X.f25, X.f75], to: [X.f125, X.f875] })
    fireEvent(stack, wheelEvent({ deltaY: -50, ctrlKey: true }))

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('detaches its window listeners on unmount', async () => {
    const { stack, onZoomChange, unmount } = renderHarness()

    fireEvent.pointerDown(stack, touch(X.f25, 1))
    fireEvent.pointerDown(stack, touch(X.f75, 2))
    unmount()
    fireEvent.pointerMove(window, touch(X.f125, 1))
    await nextFrame()

    expect(onZoomChange).not.toHaveBeenCalled()
  })
})

// HONESTY NOTE, and it matters: jsdom implements no passive-listener semantics
// at all. `defaultPrevented === true` above proves the handler ran and called
// preventDefault — it does NOT prove the listener was registered non-passive.
// React attaches wheel/touchstart/touchmove at the root as {passive: true}, so
// moving any of this into a JSX onWheel/onTouchMove would leave every test in
// this file green while ctrl+wheel silently started zooming the whole browser
// page instead of the chart. That difference is only observable in a real
// browser — see the manual checks in README.md.
//
// The pan tests lean on the same illusion twice over: jsdom has no history
// gesture either, so nothing here can catch the pan's *other* job — a
// horizontal swipe is a back-navigation in Safari and Chrome, and only that
// preventDefault stops a pan past the end of the activity from throwing the
// loaded file away. Check it in a browser.
