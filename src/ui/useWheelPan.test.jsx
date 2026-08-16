import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { fullDomain, viewDomainFor, windowFractions } from '../domain/zoomDomain.js'
import { useWheelPan } from './useWheelPan.js'

// Driven through a bare harness rather than through ChartStack on purpose: an
// onZoomChange spy shows the emitted domain exactly, instead of reverse-
// engineering it out of an SVG path, and it sidesteps ResponsiveContainer's
// async measurement entirely. ChartStack.test.jsx covers the wiring into the
// real chart; this file covers the gesture.
//
// This file is what survived usePinchZoom.test.jsx: the pinch, the ctrl/⌘+wheel
// zoom and the multi-touch guard were deleted along with the gestures
// themselves (useWheelPan.js's header says why), and the pan is all that is
// left here.
function Harness({ onZoomChange, domain = fullDomain(), fullExtent = [0, 100] }) {
  // Derived here exactly as ChartStack derives it, rather than passed in: the
  // hook is specified against a window and the view that would actually be
  // drawn around it, and a test free to name both could specify a pair that
  // cannot coexist. `domain` is THE WINDOW throughout this file.
  const view = viewDomainFor(domain, fullExtent)
  const { ref } = useWheelPan({
    domain,
    windowFractions: windowFractions(domain, view, fullExtent),
    fullExtent,
    onZoomChange,
  })
  return (
    <div ref={ref} data-testid="stack">
      {/* What plotRectOf measures. setupTests.js returns the same fixed
          {left:0, width:800} rect for every element, so this stands in for a
          real Recharts <svg>. */}
      <svg className="recharts-surface" />
    </div>
  )
}

// Under the global rect stub the plot area is {left: 60, width: 728}, and
// 728 = 8 × 91 — so eighth-fractions land on integer clientX values.
const X = { f50: 424 }

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

function renderHarness(props = {}) {
  const onZoomChange = vi.fn()
  const utils = render(<Harness onZoomChange={onZoomChange} {...props} />)
  return { ...utils, onZoomChange, stack: utils.getByTestId('stack') }
}

// The wheel path is not rAF-coalesced, so every assertion below is synchronous.
describe('useWheelPan — trackpad pan', () => {
  it('slides the zoomed window by exactly the swipe distance as a fraction of the plot', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    // 91px of the 728px plot is exactly an eighth. The plot draws the 60-wide
    // VIEW around this 40-wide window, so an eighth of it is 7.5 — that is what
    // keeps finger travel and content travel 1:1 (toWindowDelta). Positive
    // deltaX moves the window forward, like a scrollbar.
    const event = wheelEvent({ deltaY: 0, deltaX: 91 })
    fireEvent(stack, event)

    expect(onZoomChange).toHaveBeenCalledTimes(1)
    expect(onZoomChange.mock.calls[0][0]).toEqual([27.5, 67.5])
    expect(event.defaultPrevented).toBe(true)
  })

  it('pans backward on a negative deltaX', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: -91 }))

    expect(onZoomChange.mock.calls[0][0]).toEqual([12.5, 52.5])
  })

  it('keeps the width bit-identical even at a deep zoom', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [30, 31] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 91 }))

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted[1] - emitted[0]).toBe(1)
  })

  it('ignores a vertical-dominant wheel, so an ordinary read-through does not jitter the window sideways', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    // A macOS two-finger scroll is always slightly diagonal — panning on any
    // deltaX at all would make reading down the page drag the chart.
    const event = wheelEvent({ deltaY: 50, deltaX: 5 })
    fireEvent(stack, event)

    expect(onZoomChange).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
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

    expect(onZoomChange.mock.calls[0][0]).toEqual([27.5, 67.5])
  })

  it('normalises a line-mode horizontal delta', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    // 3 lines × 16px = 48px sideways — without the normalisation Firefox's
    // sideways swipe would move the window by three ten-thousandths of a plot.
    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 3, deltaMode: 1 }))

    const emitted = onZoomChange.mock.calls[0][0]
    // Against the 60-wide view, as above.
    expect(emitted[0]).toBeCloseTo(20 + (48 / 728) * 60, 9)
  })

  it('stops dead at the end of the activity instead of running off it', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [50, 90] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 728 })) // a full plot width

    const emitted = onZoomChange.mock.calls[0][0]
    expect(emitted).toEqual([60, 100])
    expect(emitted[1] - emitted[0]).toBe(40)
  })
})

describe('useWheelPan — the deleted zoom', () => {
  it('leaves a ctrl+wheel entirely alone, so the browser page-zooms', () => {
    // A macOS trackpad pinch arrives as exactly this. It used to zoom the
    // chart; dragging a window edge is the only zoom now, so this event must
    // reach the browser untouched.
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    const event = wheelEvent({ deltaY: -50, ctrlKey: true })
    fireEvent(stack, event)

    expect(onZoomChange).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves a ⌘+wheel alone too', () => {
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    const event = wheelEvent({ deltaY: -50, metaKey: true })
    fireEvent(stack, event)

    expect(onZoomChange).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('still PANS a ctrl + horizontal-dominant scroll, since the modifier no longer means anything here', () => {
    // Not a special case in the code, and worth pinning: the ctrl branch is
    // gone rather than inverted, so a held modifier does not disable the pan.
    const { stack, onZoomChange } = renderHarness({ domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 91, ctrlKey: true }))

    expect(onZoomChange.mock.calls[0][0]).toEqual([27.5, 67.5])
  })
})

describe('useWheelPan — safety', () => {
  it('does nothing at all without an extent (no activity loaded yet)', () => {
    const { stack, onZoomChange } = renderHarness({ fullExtent: null, domain: [20, 60] })

    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 91 }))

    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('detaches its listener on unmount', () => {
    const { stack, onZoomChange, unmount } = renderHarness({ domain: [20, 60] })

    unmount()
    fireEvent(stack, wheelEvent({ deltaY: 0, deltaX: 91 }))

    expect(onZoomChange).not.toHaveBeenCalled()
  })
})

// HONESTY NOTE, and it matters: jsdom implements no passive-listener semantics
// at all. `defaultPrevented === true` above proves the handler ran and called
// preventDefault — it does NOT prove the listener was registered non-passive.
// React attaches wheel at the root as {passive: true}, so moving this into a
// JSX onWheel would leave every test in this file green while the pan silently
// stopped suppressing the browser's default scroll.
//
// The pan tests lean on the same illusion twice over: jsdom has no history
// gesture either, so nothing here can catch the pan's *other* job — a
// horizontal swipe is a back-navigation in Safari and Chrome, and only that
// preventDefault stops a pan past the end of the activity from throwing the
// loaded file away. Check it in a browser.
//
// And the "browser page-zooms instead" tests above prove only that this hook
// keeps its hands off the event. Whether the page actually magnifies is down to
// `.chart-stack`'s `touch-action: pan-y pinch-zoom`, which jsdom does not
// implement either — see the manual checks in README.md.
