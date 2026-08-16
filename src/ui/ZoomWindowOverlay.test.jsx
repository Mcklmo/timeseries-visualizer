import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CHART_MARGIN, X_AXIS_HEIGHT } from './chartGeometry.js'
import { ZoomWindowOverlay } from './ZoomWindowOverlay.jsx'

// The overlay is positioned entirely in percentages of the plot area, which is
// exactly why it can be asserted like this: setupTests.js hands every element
// the same fixed 800×200 rect, so a test that measured anything would be
// measuring the stub. These assertions read the styles the component asked for.
const DEFAULT_PROPS = {
  fractions: [0, 1],
  showXAxis: true,
  windowValues: [0, 3600],
  fullExtent: [0, 3600],
  xMode: 'time',
}

function renderOverlay(props = {}) {
  return render(<ZoomWindowOverlay {...DEFAULT_PROPS} {...props} />)
}

const shoulders = (container) => [...container.querySelectorAll('.zoom-window__shoulder')]
const handles = () => screen.getAllByRole('slider')

describe('ZoomWindowOverlay', () => {
  it('draws shoulders that track the window fractions', () => {
    const { container } = renderOverlay({ fractions: [0.25, 0.75] })
    const [left, right] = shoulders(container)
    expect(left.style.width).toBe('25%')
    expect(right.style.left).toBe('75%')
    expect(right.style.right).toBe('0px')
  })

  it('renders zero-width shoulders when unzoomed, rather than not rendering at all', () => {
    // The handles parked on the plot edges ARE the affordance for starting a
    // trim, which is why the overlay is not conditional on being zoomed. At
    // zero width nothing is dimmed, so an idle chart looks exactly as it did.
    const { container } = renderOverlay({ fractions: [0, 1] })
    const [left, right] = shoulders(container)
    expect(left.style.width).toBe('0%')
    expect(right.style.left).toBe('100%')
  })

  it('puts the two handles on the two boundaries', () => {
    renderOverlay({ fractions: [0.25, 0.75] })
    const [start, end] = handles()
    expect(start.style.left).toBe('25%')
    expect(end.style.left).toBe('75%')
    expect(start).toHaveAccessibleName('Window start')
    expect(end).toHaveAccessibleName('Window end')
  })

  it('clears the x-axis band on the panel that draws one, and only that panel', () => {
    // Otherwise the shoulders wash out the tick labels the whole stack reads
    // its position from. X_AXIS_HEIGHT is Recharts' own default, stated in
    // chartGeometry.js precisely so this inset and the axis agree.
    const { container: withAxis } = renderOverlay({ showXAxis: true })
    const { container: without } = renderOverlay({ showXAxis: false })
    expect(withAxis.querySelector('.zoom-window').style.bottom).toBe(`${CHART_MARGIN.bottom + X_AXIS_HEIGHT}px`)
    expect(without.querySelector('.zoom-window').style.bottom).toBe(`${CHART_MARGIN.bottom}px`)
  })

  it('reports each edge as a slider over the whole activity', () => {
    renderOverlay({ fractions: [0.25, 0.75], windowValues: [600, 1800], fullExtent: [0, 3600] })
    const [start, end] = handles()
    expect(start).toHaveAttribute('aria-valuemin', '0')
    expect(start).toHaveAttribute('aria-valuemax', '3600')
    expect(start).toHaveAttribute('aria-valuenow', '600')
    expect(start).toHaveAttribute('aria-valuetext', '10:00')
    expect(end).toHaveAttribute('aria-valuetext', '30:00')
  })

  it('reads the values out in the units the axis is in', () => {
    renderOverlay({ windowValues: [1000, 5000], fullExtent: [0, 10000], xMode: 'distance' })
    expect(handles()[0]).toHaveAttribute('aria-valuetext', '1.00 km')
  })

  it('moves an edge by a percent of the activity on an arrow key', () => {
    const onEdgeKeyMove = vi.fn()
    renderOverlay({ windowValues: [600, 1800], fullExtent: [0, 3600], onEdgeKeyMove })

    fireEvent.keyDown(handles()[0], { key: 'ArrowRight' })
    expect(onEdgeKeyMove).toHaveBeenCalledWith('start', 600 + 36)

    fireEvent.keyDown(handles()[0], { key: 'ArrowLeft' })
    expect(onEdgeKeyMove).toHaveBeenLastCalledWith('start', 600 - 36)
  })

  it('takes a bigger step on Page Up/Down, and parks the edge on End/Home', () => {
    const onEdgeKeyMove = vi.fn()
    renderOverlay({ windowValues: [600, 1800], fullExtent: [0, 3600], onEdgeKeyMove })

    fireEvent.keyDown(handles()[1], { key: 'PageUp' })
    expect(onEdgeKeyMove).toHaveBeenLastCalledWith('end', 1800 + 360)

    // Home and End together are how the keyboard gets back to unzoomed.
    fireEvent.keyDown(handles()[1], { key: 'End' })
    expect(onEdgeKeyMove).toHaveBeenLastCalledWith('end', 3600)
    fireEvent.keyDown(handles()[0], { key: 'Home' })
    expect(onEdgeKeyMove).toHaveBeenLastCalledWith('start', 0)
  })

  it('leaves keys it does not handle alone, so Tab still reaches the other handle', () => {
    const onEdgeKeyMove = vi.fn()
    renderOverlay({ onEdgeKeyMove })
    const event = fireEvent.keyDown(handles()[0], { key: 'Tab' })
    expect(onEdgeKeyMove).not.toHaveBeenCalled()
    expect(event).toBe(true) // not prevented
  })

  it('hands a pointerdown to the drag with the edge it landed on', () => {
    const onEdgePointerDown = vi.fn()
    renderOverlay({ onEdgePointerDown })
    fireEvent.pointerDown(handles()[1], { clientX: 400 })
    expect(onEdgePointerDown).toHaveBeenCalledTimes(1)
    expect(onEdgePointerDown.mock.calls[0][0]).toBe('end')
  })

  it('is inert without an extent: the sliders say nothing rather than guessing', () => {
    // A panel rendered bare has no extent to name, and an aria-valuenow of NaN
    // is worse than none at all.
    const onEdgeKeyMove = vi.fn()
    renderOverlay({ windowValues: [NaN, NaN], fullExtent: null, onEdgeKeyMove })
    expect(handles()[0]).not.toHaveAttribute('aria-valuenow')
    expect(handles()[0]).not.toHaveAttribute('aria-valuetext')
    fireEvent.keyDown(handles()[0], { key: 'ArrowRight' })
    expect(onEdgeKeyMove).not.toHaveBeenCalled()
  })
})
