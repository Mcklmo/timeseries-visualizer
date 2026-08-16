import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { fullDomain, minSpanFor } from '../domain/zoomDomain.js'
import { parseCursorX } from './chartGeometry.js'
import { useEdgeDrag } from './useEdgeDrag.js'

// Driven through a bare harness rather than through ChartStack, for the same
// reason useWheelPan.test.jsx is: spies show the emitted windows exactly,
// instead of reverse-engineering them out of an SVG path. ChartStack.test.jsx
// covers the wiring into the real chart.
//
// onWindowChange takes TWO arguments — (window, view) — so most assertions here
// name both. The view is the frozen one at pointerdown, except while the
// pointer is held past the plot edge, which is the `— expansion` describe.
function Harness({ onWindowChange, onWindowCommit, zoomDomain = fullDomain(), viewDomain = fullDomain(), ...rest }) {
  const { ref, onEdgePointerDown } = useEdgeDrag({
    zoomDomain,
    viewDomain,
    fullExtent: [0, 100],
    onWindowChange,
    onWindowCommit,
    ...rest,
  })
  return (
    <div ref={ref} data-testid="stack">
      {/* What plotRectOf and the crosshair dispatch look for. setupTests.js
          returns the same fixed {left: 0, width: 800} rect for every element,
          so this stands in for a real Recharts panel. */}
      <div className="recharts-wrapper">
        <svg className="recharts-surface">
          <path className="recharts-tooltip-cursor" d="M0,0L0,100" />
        </svg>
      </div>
      <button type="button" onPointerDown={(e) => onEdgePointerDown('start', e)}>
        start
      </button>
      <button type="button" onPointerDown={(e) => onEdgePointerDown('end', e)}>
        end
      </button>
    </div>
  )
}

// Under the global rect stub the plot area is {left: 60, width: 728}.
const X = { f0: 60, f25: 242, f50: 424, f75: 606, f100: 788 }

// Emission is rAF-coalesced.
const nextFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)))

function renderHarness(props = {}) {
  const onWindowChange = vi.fn()
  const onWindowCommit = vi.fn()
  const utils = render(<Harness onWindowChange={onWindowChange} onWindowCommit={onWindowCommit} {...props} />)
  return { ...utils, onWindowChange, onWindowCommit, handle: (edge) => utils.getByText(edge) }
}

async function drag(handle, { from, to }) {
  fireEvent.pointerDown(handle, { clientX: from })
  await nextFrame()
  fireEvent.pointerMove(window, { clientX: to })
  await nextFrame()
}

// The expansion loop feeds back through state — each frame grows the window it
// is handed — so it has to be driven through a harness that actually writes
// what the hook emits, exactly as ChartStack does with setZoom. The one above
// holds its props fixed, which is right for the direct phase and would make the
// walk stand still.
function LiveHarness({ onWindowChange, onWindowCommit, zoomDomain: initial, viewDomain: initialView, ...rest }) {
  const [zoom, setZoom] = useState({ window: initial, view: initialView })
  const { ref, onEdgePointerDown } = useEdgeDrag({
    zoomDomain: zoom.window,
    viewDomain: zoom.view,
    fullExtent: [0, 100],
    onWindowChange: (next, view) => {
      setZoom({ window: next, view })
      onWindowChange?.(next, view)
    },
    onWindowCommit,
    ...rest,
  })
  return (
    <div ref={ref} data-testid="stack">
      <div className="recharts-wrapper">
        <svg className="recharts-surface">
          <path className="recharts-tooltip-cursor" d="M0,0L0,100" />
        </svg>
      </div>
      <button type="button" onPointerDown={(e) => onEdgePointerDown('start', e)}>
        start
      </button>
      <button type="button" onPointerDown={(e) => onEdgePointerDown('end', e)}>
        end
      </button>
    </div>
  )
}

function renderLive(props = {}) {
  const onWindowChange = vi.fn()
  const onWindowCommit = vi.fn()
  const utils = render(<LiveHarness onWindowChange={onWindowChange} onWindowCommit={onWindowCommit} {...props} />)
  return { ...utils, onWindowChange, onWindowCommit, handle: (edge) => utils.getByText(edge) }
}

/** Let the expansion loop run for a few of its own frames. jsdom's rAF has real
 *  timing, so nothing here may assert an exact amount — see the describe. */
async function frames(count) {
  for (let i = 0; i < count; i += 1) await nextFrame()
}

const windowsFrom = (spy) => spy.mock.calls.map((c) => c[0])
const viewsFrom = (spy) => spy.mock.calls.map((c) => c[1])

describe('useEdgeDrag', () => {
  it('moves the dragged edge to the pointer and leaves the other one alone', async () => {
    const { handle, onWindowChange } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    await drag(handle('start'), { from: X.f25, to: X.f50 })

    // Half way across the plot, solved against the view [10, 90]: 50.
    expect(onWindowChange).toHaveBeenLastCalledWith([50, 80], [10, 90])
  })

  it('solves against the view as it was at pointerdown, NOT as it becomes', async () => {
    // The runaway this freeze exists to stop: if the view tracked the window
    // live, the handle would redraw at a fixed plot fraction every frame,
    // always on the far side of the pointer, and the window would shrink
    // without converging. Re-solving each frame against the FROZEN view is
    // what makes a drag land where the pointer is.
    const { handle, onWindowChange } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f25 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: X.f75 })
    await nextFrame()

    // Both frames read off the same [10, 90]: 0.5 → 50, 0.75 → 70. A view that
    // had re-fitted around [50, 80] in between would put the second frame at 65.
    expect(onWindowChange.mock.calls.map((c) => c[0])).toEqual([[30, 80], [50, 80], [70, 80]])
    // And every one of them reported the SAME view back, which is what the
    // caller writes alongside the window.
    for (const call of onWindowChange.mock.calls) expect(call[1]).toEqual([10, 90])
  })

  it('emits only the window while dragging — the caller re-fits the view once, on release', async () => {
    const { handle, onWindowChange, onWindowCommit } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    await drag(handle('end'), { from: X.f75, to: X.f50 })
    expect(onWindowCommit).not.toHaveBeenCalled()

    fireEvent.pointerUp(window, { clientX: X.f50 })
    expect(onWindowCommit).toHaveBeenCalledTimes(1)
    expect(onWindowCommit).toHaveBeenCalledWith([20, 50])
    // Commit takes the window alone: the caller re-fits the view symmetrically
    // around it rather than keeping the drag's own.
    expect(onWindowCommit.mock.calls[0]).toHaveLength(1)
    expect(onWindowChange).toHaveBeenLastCalledWith([20, 50], [10, 90])
  })

  it('clamps at the plot edges rather than dragging the window out of the view', async () => {
    const { handle, onWindowChange } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    await drag(handle('start'), { from: X.f25, to: -400 })
    // The first frame past the edge grows by nothing — there is no earlier
    // timestamp to measure a dt against — so this is still the clamp.
    expect(onWindowChange.mock.calls[1]).toEqual([[10, 80], [10, 90]])
  })

  it('holds the min-span floor instead of letting the edges cross', async () => {
    const { handle, onWindowChange } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    await drag(handle('start'), { from: X.f25, to: X.f100 })
    expect(onWindowChange).toHaveBeenLastCalledWith([80 - minSpanFor(100), 80], [10, 90])
  })

  it('drives the crosshair to the boundary, so every panel reads out where the edge is', async () => {
    // The whole point of the gesture being direct manipulation: you trim by
    // watching the numbers, not by arithmetic. There is no imperative way to
    // move Recharts' hover — this is the synthetic mousemove of
    // ui/crosshairDispatch.js, and this test is what pins it to the drag.
    const moves = []
    const { handle, container } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })
    container.querySelector('.recharts-wrapper').addEventListener('mousemove', (e) => moves.push(e.clientX))

    await drag(handle('start'), { from: X.f25, to: X.f50 })

    expect(moves.at(-1)).toBe(X.f50)
  })

  it('clamps that crosshair into the plot, since a mousemove outside it DELETES the crosshair', async () => {
    const moves = []
    const { handle, container } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })
    container.querySelector('.recharts-wrapper').addEventListener('mousemove', (e) => moves.push(e.clientX))

    await drag(handle('start'), { from: X.f25, to: 5000 })

    expect(moves.at(-1)).toBe(X.f100)
    // And the path it lands on is a real one — parseCursorX is what
    // crosshairClientX reads back, so this is the same shape the app relies on.
    expect(parseCursorX(container.querySelector('.recharts-tooltip-cursor').getAttribute('d'))).toBe(0)
  })

  it('treats a sentinel window and view as the whole activity, so the first trim works', async () => {
    const { handle, onWindowChange } = renderHarness()

    await drag(handle('start'), { from: X.f0, to: X.f25 })
    // The sentinel view survives the round trip rather than coming back as a
    // numeric [0, 100] — snapToFull on the emitted view is what keeps the
    // unzoomed render byte-identical.
    expect(onWindowChange).toHaveBeenLastCalledWith([25, 100], fullDomain())
  })

  it('snaps back to the sentinel when an edge is dragged out to the end of the activity', async () => {
    const { handle, onWindowCommit } = renderHarness({ zoomDomain: [0, 60], viewDomain: fullDomain() })

    await drag(handle('end'), { from: X.f50, to: X.f100 })
    fireEvent.pointerUp(window, { clientX: X.f100 })

    // Which is how the Reset control disappears — the same rule everything else
    // already follows.
    expect(onWindowCommit).toHaveBeenCalledWith(fullDomain())
  })

  it('commits what the last frame emitted when the pointer is cancelled', async () => {
    // A cancelled pointer never releases, and a view left frozen behind it
    // would be a chart that quietly stops re-fitting for the rest of the
    // session.
    const { handle, onWindowCommit } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    await drag(handle('start'), { from: X.f25, to: X.f50 })
    fireEvent.pointerCancel(window, { clientX: X.f50 })

    expect(onWindowCommit).toHaveBeenCalledWith([50, 80])
  })

  it('stops listening after the gesture ends, so a stray pointermove moves nothing', async () => {
    const { handle, onWindowChange } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    await drag(handle('start'), { from: X.f25, to: X.f50 })
    fireEvent.pointerUp(window, { clientX: X.f50 })
    onWindowChange.mockClear()

    fireEvent.pointerMove(window, { clientX: X.f75 })
    await nextFrame()
    expect(onWindowChange).not.toHaveBeenCalled()
  })

  it('does not clear the crosshair on release — the numbers are there to be read', async () => {
    const events = []
    const { handle, container } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })
    const wrapper = container.querySelector('.recharts-wrapper')
    wrapper.addEventListener('mouseout', () => events.push('out'))
    wrapper.addEventListener('mouseleave', () => events.push('leave'))

    await drag(handle('start'), { from: X.f25, to: X.f50 })
    fireEvent.pointerUp(window, { clientX: X.f50 })

    // The same deliberate choice useTouchScrub.handleTouchEnd makes: the panel
    // driving the readout keeps it after the hand comes off.
    expect(events).toEqual([])
  })

  it('does nothing at all without an extent, rather than emitting a garbage window', async () => {
    const { handle, onWindowChange, onWindowCommit } = renderHarness({ fullExtent: null })

    await drag(handle('start'), { from: X.f25, to: X.f50 })
    fireEvent.pointerUp(window, { clientX: X.f50 })

    expect(onWindowChange).not.toHaveBeenCalled()
    expect(onWindowCommit).not.toHaveBeenCalled()
  })

  it('ignores a second pointer, so another finger anywhere cannot drive the drag', async () => {
    // Which matters now that a two-finger pinch over the charts is a live
    // BROWSER gesture rather than one this app swallows: the second finger of
    // a page zoom must not steer the edge being dragged.
    const { handle, onWindowChange } = renderHarness({ zoomDomain: [20, 80], viewDomain: [10, 90] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f25, pointerId: 1 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: X.f75, pointerId: 2 })
    await nextFrame()
    expect(onWindowChange).toHaveBeenLastCalledWith([30, 80], [10, 90])

    // And the drag's own pointer still works after it.
    fireEvent.pointerMove(window, { clientX: X.f50, pointerId: 1 })
    await nextFrame()
    expect(onWindowChange).toHaveBeenLastCalledWith([50, 80], [10, 90])

    // Nor can the other one end it.
    fireEvent.pointerUp(window, { clientX: X.f75, pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: X.f75, pointerId: 1 })
    await nextFrame()
    expect(onWindowChange).toHaveBeenLastCalledWith([70, 80], [10, 90])
  })
})

// jsdom's rAF has REAL timing, so every assertion here is about monotonicity,
// direction and stopping — never an exact amount. An exact expansion assertion
// would flake on a loaded machine.
describe('useEdgeDrag — expansion at the plot edge', () => {
  it('keeps scheduling its own frames while the pointer is held past the edge', async () => {
    // The half nothing else here can see: the finger is STATIONARY, so no
    // pointermove is scheduling anything. Two pointer events went in; more than
    // two emissions came out, so the rAF loop is re-arming itself.
    const { handle, onWindowChange } = renderLive({ zoomDomain: [40, 60], viewDomain: [35, 65] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: -50 })
    await frames(3)

    expect(onWindowChange.mock.calls.length).toBeGreaterThan(3)
  })

  it('grows the window monotonically outward, and stops the instant the pointer comes back inside', async () => {
    const { handle, onWindowChange } = renderLive({ zoomDomain: [40, 60], viewDomain: [35, 65] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: -50 })
    await frames(4)

    const starts = windowsFrom(onWindowChange).map((w) => w[0])
    expect(starts.at(-1)).toBeLessThan(starts[0])
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]).toBeLessThanOrEqual(starts[i - 1])

    // Back inside, and the walk stops dead — the edge goes back to tracking the
    // pointer, which is the whole phase change.
    fireEvent.pointerMove(window, { clientX: X.f50 })
    await frames(3)
    const settled = windowsFrom(onWindowChange).at(-1)
    await frames(3)
    expect(windowsFrom(onWindowChange).at(-1)).toEqual(settled)
  })

  it('grows the view on the dragged side only, leaving the far side exactly where it was', async () => {
    const { handle, onWindowChange } = renderLive({ zoomDomain: [40, 60], viewDomain: [35, 65] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: -50 })
    await frames(4)

    const views = viewsFrom(onWindowChange)
    // The half being kept does not move: earlier data flows in from outside
    // rather than the whole chart rescaling under the hand.
    for (const view of views) expect(view[1]).toBe(65)
    expect(views.at(-1)[0]).toBeLessThan(views[0][0])
  })

  it('keeps the handle at plot fraction 0, so nothing teleports when the pointer comes back inside', async () => {
    // The single property the whole design rests on: the expanding view's start
    // IS the window's start, so the dragged handle sits exactly under the
    // finger at the plot edge for the entire walk.
    const { handle, onWindowChange } = renderLive({ zoomDomain: [40, 60], viewDomain: [35, 65] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: -50 })
    await frames(4)

    for (const [win, view] of onWindowChange.mock.calls.slice(1)) {
      expect(win[0]).toBe(view[0])
    }
  })

  it('does the mirror image for the end edge', async () => {
    const { handle, onWindowChange } = renderLive({ zoomDomain: [40, 60], viewDomain: [35, 65] })

    fireEvent.pointerDown(handle('end'), { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: 5000 })
    await frames(4)

    const calls = onWindowChange.mock.calls
    expect(calls.at(-1)[0][1]).toBeGreaterThan(calls[0][0][1])
    for (const [win, view] of calls.slice(1)) {
      expect(view[0]).toBe(35)
      expect(win[1]).toBe(view[1])
    }
  })

  it('clamps at the extent and snaps back to the sentinel, so Reset zoom disappears', async () => {
    // A window pinned against the start of the activity, whose left shoulder is
    // therefore zero-width — exactly what viewDomainFor([0, 60], [0, 100])
    // returns. The end edge has one span-doubling left to walk, ln(100/75) ≈
    // 0.29s of it, so this needs real frames rather than a couple.
    const { handle, onWindowChange, onWindowCommit } = renderLive({ zoomDomain: [0, 60], viewDomain: [0, 75] })

    fireEvent.pointerDown(handle('end'), { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: 5000 })
    await frames(40)

    expect(windowsFrom(onWindowChange).at(-1)).toEqual(fullDomain())
    fireEvent.pointerUp(window, { clientX: 5000 })
    expect(onWindowCommit).toHaveBeenLastCalledWith(fullDomain())
  })

  it('stops emitting once it is clamped at the extent, rather than re-rendering at 60Hz forever', async () => {
    // An edge already parked against the extent still reads as "held at the plot
    // edge", so the loop keeps running and keeps solving to the same number.
    // Every emission writes state and re-renders every panel, so the frame that
    // changes nothing must not emit.
    const { handle, onWindowChange } = renderLive({ zoomDomain: [0, 60], viewDomain: [0, 75] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f50 })
    await nextFrame()
    // Already at the extent's start: there is nowhere left to expand to.
    fireEvent.pointerMove(window, { clientX: -50 })
    await frames(3)
    const settled = onWindowChange.mock.calls.length

    await frames(3)
    expect(onWindowChange.mock.calls.length).toBe(settled)
  })

  it('never expands past the extent however long it is held', async () => {
    const { handle, onWindowChange } = renderLive({ zoomDomain: [40, 60], viewDomain: [35, 65] })

    fireEvent.pointerDown(handle('start'), { clientX: X.f50 })
    await nextFrame()
    fireEvent.pointerMove(window, { clientX: -50 })
    await frames(10)

    for (const win of windowsFrom(onWindowChange)) {
      if (win[0] === 'dataMin') continue
      expect(win[0]).toBeGreaterThanOrEqual(0)
    }
  })
})
