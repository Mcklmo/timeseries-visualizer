// Recharts-free coverage of the gesture itself, in the style of
// useTouchHoverHandoff.test.jsx: the hook's whole job is "dispatch a mousemove
// at anchor + dx, and only for the gestures that are ours", and that is
// observable with two plain wrappers and a spy. The end-to-end proof — that a
// real Recharts crosshair actually moves by the finger's distance — lives in
// ChartStack.test.jsx.
//
// jsdom 30 has no Touch constructor, but fireEvent.touchStart/Move/End accept
// plain objects in `touches`,
// which is all these handlers read. setupTests.js hard-assigns one fixed
// {left: 0, width: 800} rect to EVERY element, so the plot under any wrapper
// here is {left: 60, width: 728} — the same numbers ChartStack.test.jsx uses.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useTouchScrub } from './useTouchScrub.js'

// A crosshair at SVG x=242 (the fixture's second sample in the chart tests),
// which under the fixed rect is client x 242 as well.
const CURSOR_AT_242 = 'M242,5L242,195'

function Stack({ mounted = true, cursor = CURSOR_AT_242, rightInset = 0 }) {
  const ref = useTouchScrub({ rightInset })
  if (!mounted) return null
  return (
    <div className="chart-stack" ref={ref}>
      <button type="button" data-testid="chrome">
        Reset zoom
      </button>
      <div className="recharts-wrapper" data-testid="a">
        <svg className="recharts-surface" data-testid="a-svg">
          {cursor && <path className="recharts-tooltip-cursor" d={cursor} />}
        </svg>
      </div>
      <div className="recharts-wrapper" data-testid="b">
        <svg className="recharts-surface">{cursor && <path className="recharts-tooltip-cursor" d={cursor} />}</svg>
      </div>
    </div>
  )
}

/** Every mousemove the hook dispatched, as client x values. Listens on the
 *  container so it sees the event wherever in the stack it was dispatched. */
function spyOnMoves(container) {
  const spy = vi.fn()
  container.addEventListener('mousemove', spy)
  return () => spy.mock.calls.map(([e]) => e.clientX)
}

const at = (clientX, clientY = 100) => ({ touches: [{ clientX, clientY }] })
const twoFingers = { touches: [{ clientX: 200, clientY: 100 }, { clientX: 400, clientY: 100 }] }
const lifted = { touches: [] }

describe('useTouchScrub', () => {
  it('leaves the crosshair alone for a tap, however far it lands from it', () => {
    // The one move is at 242 — where the crosshair already was — so nothing
    // shifts. The next test says why that dispatch exists at all.
    const { container, getByTestId } = render(<Stack />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    fireEvent.touchEnd(getByTestId('a-svg'), lifted)

    expect(moves()).toEqual([242])
  })

  it('re-asserts the crosshair on the touched panel, at exactly where it already is', () => {
    // Reads like a no-op and is not. useTouchHoverHandoff clears every OTHER
    // panel's hover on this same touchstart, and if the panel it clears is the
    // one holding the hover, that panel emits a sync event with active: false
    // which cascade-clears the rest — the crosshair vanishes on a tap. This
    // dispatch makes the TOUCHED panel the owner, which is the state the
    // handoff is handing over. Take it out and the ChartStack test "leaves the
    // crosshair exactly where it is when a chart is tapped" fails.
    const { getByTestId } = render(<Stack />)
    const onB = vi.fn()
    getByTestId('b').addEventListener('mousemove', onB)

    fireEvent.touchStart(getByTestId('b'), at(606))

    expect(onB.mock.calls.map(([e]) => e.clientX)).toEqual([242])
  })

  it('drags the crosshair by the distance the finger travelled, not to the finger', () => {
    // THE feature: anchored at 242, finger down at 606 and moved +182 → the
    // crosshair goes to 424, nowhere near the fingertip.
    const { container, getByTestId } = render(<Stack />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    fireEvent.touchMove(getByTestId('a-svg'), at(788))

    expect(moves()).toEqual([242, 424])
  })

  it('re-reads the crosshair per gesture, so successive swipes accumulate', () => {
    // The DOM is the truth (crosshairClientX): a cached "last x I dispatched"
    // would make every swipe measure from the original position.
    const { container, getByTestId, rerender } = render(<Stack />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    fireEvent.touchMove(getByTestId('a-svg'), at(788))
    fireEvent.touchEnd(getByTestId('a-svg'), lifted)
    // Stands in for Recharts re-rendering the cursor where we just put it.
    rerender(<Stack cursor="M424,5L424,195" />)
    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    fireEvent.touchMove(getByTestId('a-svg'), at(788))

    // The second swipe starts from 424, not from the original 242.
    expect(moves()).toEqual([242, 424, 424, 606])
  })

  it('places the crosshair at the finger on the first touch, when there is none to preserve', () => {
    // The one and only absolute placement, and what makes the gesture
    // discoverable — there is nothing on screen to lose.
    const { container, getByTestId } = render(<Stack cursor={null} />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(606))

    expect(moves()).toEqual([606])
  })

  it('scrubs from where it bootstrapped, not from the crosshair it did not find', () => {
    const { container, getByTestId } = render(<Stack cursor={null} />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(242))
    fireEvent.touchMove(getByTestId('a-svg'), at(424))

    expect(moves()).toEqual([242, 424])
  })

  it('clamps at the plot edges rather than dragging past them', () => {
    // Not cosmetic: a mousemove resolving outside the plot makes Recharts
    // dispatch mouseLeaveChart(), which would DELETE the crosshair instead of
    // stopping it at the end of the activity.
    const { container, getByTestId } = render(<Stack />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(300))
    fireEvent.touchMove(getByTestId('a-svg'), at(3000))
    fireEvent.touchMove(getByTestId('a-svg'), at(-3000))

    // The plot is {left: 60, width: 728}: 60 and 788 are its inclusive edges.
    expect(moves()).toEqual([242, 788, 60])
  })

  it('measures against the narrowed plot when the derivative gutter is reserved', () => {
    // rightInset comes through the latest-ref, and the clamp is a clamp INTO
    // THE PLOT — with the gutter on, the right edge is 44px further left.
    const { container, getByTestId } = render(<Stack rightInset={44} />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(300))
    fireEvent.touchMove(getByTestId('a-svg'), at(3000))

    expect(moves()).toEqual([242, 744])
  })

  it('ignores a vertical drag, so the page scrolls and the crosshair holds', () => {
    const { container, getByTestId } = render(<Stack />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(606, 100))
    // 4px sideways, 300px down: past the slop, but nowhere near dominant.
    fireEvent.touchMove(getByTestId('a-svg'), at(610, 400))
    fireEvent.touchMove(getByTestId('a-svg'), at(700, 500))

    // Nothing beyond the touchstart's re-assertion at 242, including on the
    // second move: the axis is locked once, at the threshold, and never
    // revisited — otherwise a scroll that drifts sideways would start scrubbing
    // halfway through.
    expect(moves()).toEqual([242])
  })

  it('holds until the slop threshold, so a wobbling tap moves nothing', () => {
    const { container, getByTestId } = render(<Stack />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    fireEvent.touchMove(getByTestId('a-svg'), at(611))
    expect(moves()).toEqual([242])

    fireEvent.touchMove(getByTestId('a-svg'), at(614))
    expect(moves()).toEqual([242, 250])
  })

  it('ignores a touch that lands on chrome inside the stack entirely', () => {
    // The toolbar, every panel head with its checkboxes and the Reset zoom
    // button all live inside .chart-stack, and none of them are a chart.
    const { container, getByTestId } = render(<Stack />)
    const moves = spyOnMoves(container)
    const seen = vi.fn()
    getByTestId('chrome').addEventListener('touchstart', seen)

    fireEvent.touchStart(getByTestId('chrome'), at(606))
    fireEvent.touchMove(getByTestId('chrome'), at(788))

    expect(moves()).toEqual([])
    // And not swallowed either — a tap on a real control must still reach it.
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('abandons a scrub the moment a second finger lands, and stays abandoned', () => {
    // A pinch is the browser's page zoom. `off` is terminal until every finger
    // lifts, so raising one finger of a pinch cannot decay back into a scrub.
    const { container, getByTestId } = render(<Stack />)
    const moves = spyOnMoves(container)

    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    fireEvent.touchMove(getByTestId('a-svg'), at(788))
    expect(moves()).toEqual([242, 424])

    fireEvent.touchStart(getByTestId('a-svg'), twoFingers)
    fireEvent.touchMove(getByTestId('a-svg'), twoFingers)
    // One finger of the pinch lifts; the other is still down and still moving.
    fireEvent.touchEnd(getByTestId('a-svg'), at(700))
    fireEvent.touchMove(getByTestId('a-svg'), at(200))

    expect(moves()).toEqual([242, 424])
  })

  it('keeps a two-finger gesture away from Recharts without cancelling the page zoom', () => {
    // usePinchZoom used to stop these in the capture phase as a side effect of
    // owning the pinch, and it is gone — without this, Recharts' own
    // onTouchMove drags the crosshair to the fingers while the page magnifies.
    // The preventDefault half must NOT come with it: cancelling here would kill
    // the browser zoom, which is now the whole point of a two-finger gesture.
    const { getByTestId } = render(<Stack />)
    const seen = vi.fn()
    getByTestId('a').addEventListener('touchmove', seen)

    const event = new Event('touchmove', { bubbles: true, cancelable: true })
    event.touches = twoFingers.touches
    getByTestId('a-svg').dispatchEvent(event)

    expect(seen).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('stops touchmove in the capture phase, so Recharts never sees the finger', () => {
    // Jump path (1): React's onTouchMove on .recharts-wrapper dispatches
    // setMouseOverAxisIndex AT THE FINGER, which is what makes a held finger
    // drag the crosshair under itself. Capture-phase stopping is what keeps it
    // from reaching React's root delegation at all.
    const { getByTestId } = render(<Stack />)
    const seen = vi.fn()
    getByTestId('a').addEventListener('touchmove', seen)

    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    fireEvent.touchMove(getByTestId('a-svg'), at(788))

    expect(seen).not.toHaveBeenCalled()
  })

  it('prevents the default only once a scrub is certain', () => {
    // preventDefault on a horizontal drag is also what stops Safari and Chrome
    // turning it into a back-navigation. Before the axis is locked, and for a
    // vertical drag, the gesture must keep its default behaviour.
    const { getByTestId } = render(<Stack />)
    const move = (x, y) => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true })
      event.touches = [{ clientX: x, clientY: y }]
      getByTestId('a-svg').dispatchEvent(event)
      return event.defaultPrevented
    }

    fireEvent.touchStart(getByTestId('a-svg'), at(606, 100))
    expect(move(609, 101)).toBe(false)
    expect(move(760, 104)).toBe(true)
  })

  it('cancels touchend for its own gestures, and nobody else’s', () => {
    // Jump path (2): this is what suppresses the compatibility mousemove /
    // mousedown / click the browser synthesizes at the tap point after a tap.
    const { getByTestId } = render(<Stack />)
    const end = (target) => {
      const event = new Event('touchend', { bubbles: true, cancelable: true })
      event.touches = []
      target.dispatchEvent(event)
      return event.defaultPrevented
    }

    fireEvent.touchStart(getByTestId('a-svg'), at(606))
    expect(end(getByTestId('a-svg'))).toBe(true)

    fireEvent.touchStart(getByTestId('chrome'), at(606))
    expect(end(getByTestId('chrome'))).toBe(false)
  })

  it('drives the panel that was touched, not the first one in the stack', () => {
    const { getByTestId } = render(<Stack />)
    const onB = vi.fn()
    getByTestId('b').addEventListener('mousemove', onB)
    const onA = vi.fn()
    getByTestId('a').addEventListener('mousemove', onA)

    fireEvent.touchStart(getByTestId('b'), at(606))
    fireEvent.touchMove(getByTestId('b'), at(788))

    expect(onB.mock.calls.map(([e]) => e.clientX)).toEqual([242, 424])
    expect(onA).not.toHaveBeenCalled()
    // Bubbling and vertically centred in the wrapper: React delegates at the
    // root, and a y outside the plot would clear the crosshair instead.
    const event = onB.mock.calls[0][0]
    expect(event.bubbles).toBe(true)
    expect(event.clientY).toBe(100)
  })

  it('removes its listeners when the node detaches', () => {
    const { getByTestId, rerender } = render(<Stack />)
    const wrapper = getByTestId('a')
    const spy = vi.fn()
    wrapper.addEventListener('mousemove', spy)

    rerender(<Stack mounted={false} />)
    // The detached subtree still exists in memory, so a stray touch on it would
    // still reach a listener that was never cleaned up.
    fireEvent.touchStart(wrapper, at(606))
    fireEvent.touchMove(wrapper, at(788))

    expect(spy).not.toHaveBeenCalled()
  })
})

// HONESTY NOTE, the sibling of the one at the foot of useWheelPan.test.jsx:
// jsdom implements no passive-listener semantics, synthesizes no compatibility
// mouse events after a tap, and has no history gesture. So of the two jump
// paths this hook closes, only the first is covered above.
//
//   - `defaultPrevented === true` proves the handler ran and called
//     preventDefault; it does NOT prove the listener was registered
//     {passive: false}. Move any of this into a JSX onTouchMove/onTouchEnd and
//     every test here stays green while the preventDefault silently no-ops.
//   - Nothing here can catch jump path (2) at all — a motionless tap in a real
//     browser is followed by a synthetic mousemove/mousedown/click at the tap
//     point, and that is the path that makes a clean tap teleport the
//     crosshair. jsdom fires none of them.
//   - Nor the back-navigation: a right-to-left swipe from near the screen edge
//     is a history gesture in Safari and Chrome, and the preventDefault in the
//     scrub branch is what stops a swipe throwing the loaded activity away.
//
// All three are in the README's on-a-real-phone manual checks.
