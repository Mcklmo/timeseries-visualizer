import { describe, it, expect } from 'vitest'
import { NARROW_NOMINAL_SLOT_HEIGHT, NOMINAL_SLOT_HEIGHT, PANEL_GAP, slotLayoutFor } from './slotLayout.js'

// Unit-tested for the same reason chartGeometry is: setupTests.js pins every
// getBoundingClientRect, so a rendered test cannot tell whether the layout
// arithmetic filled the viewport or missed it by a gap. Here the inputs are
// explicit and the exact-fill invariant is pinned directly.
describe('slotLayoutFor', () => {
  it('fits as many nominal slots as the viewport holds and stretches them to fill it exactly', () => {
    // jsdom's default innerHeight, the number ChartStack's rendered tests see:
    // three 200px slots + two 12px gaps = 624 fits, a fourth (836) does not.
    const { visibleCount, slotHeight } = slotLayoutFor(768, 6)
    expect(visibleCount).toBe(3)
    expect(slotHeight).toBe((768 - 2 * PANEL_GAP) / 3)
  })

  it('fills the viewport exactly: N slots plus N−1 gaps sum back to the height', () => {
    for (const height of [300, 500, 768, 1000, 1440, 2160]) {
      const { visibleCount, slotHeight } = slotLayoutFor(height, 6)
      expect(visibleCount * slotHeight + (visibleCount - 1) * PANEL_GAP).toBeCloseTo(height, 6)
    }
  })

  it('shows exactly one uncropped graph when the window is shorter than two slots', () => {
    // The request that motivated the layout: a window with room for one graph
    // must not show a sliver of the second. One slot, the full height.
    expect(slotLayoutFor(250, 6)).toEqual({ visibleCount: 1, slotHeight: 250 })
    // Shorter than even one nominal slot still shows one graph, just short.
    expect(slotLayoutFor(120, 6)).toEqual({ visibleCount: 1, slotHeight: 120 })
  })

  it('never shows more slots than there are panels — the few there are stretch', () => {
    // A 1000px window fits four nominal slots, but with two panels the two
    // stretch to share it: 2 slots + 1 gap = 1000.
    const { visibleCount, slotHeight } = slotLayoutFor(1000, 2)
    expect(visibleCount).toBe(2)
    expect(slotHeight).toBe((1000 - PANEL_GAP) / 2)
  })

  it('survives zero panels without dividing by zero', () => {
    // Nothing renders in this state; the layout just has to stay finite.
    const { visibleCount, slotHeight } = slotLayoutFor(768, 0)
    expect(visibleCount).toBe(1)
    expect(Number.isFinite(slotHeight)).toBe(true)
  })

  it('fits more, shorter slots with the narrow nominal', () => {
    // §9's ~25% reduction below 720px carries over as a smaller nominal:
    // the same 768px window that fits three 200px slots fits four 150px ones.
    const { visibleCount, slotHeight } = slotLayoutFor(768, 6, { nominal: NARROW_NOMINAL_SLOT_HEIGHT })
    expect(visibleCount).toBe(4)
    expect(slotHeight).toBe((768 - 3 * PANEL_GAP) / 4)
    // And the default really is the wide nominal, so the two cases above are
    // testing different code paths, not the same one twice.
    expect(NOMINAL_SLOT_HEIGHT).toBeGreaterThan(NARROW_NOMINAL_SLOT_HEIGHT)
  })

  it('counts the gaps when deciding how many fit', () => {
    // Exactly three slots and their gaps: 3·200 + 2·12 = 624 fits …
    expect(slotLayoutFor(624, 6).visibleCount).toBe(3)
    // … but one pixel less does not: without the gap term this would still
    // report 3 and the third graph would poke one pixel past the viewport.
    expect(slotLayoutFor(623, 6).visibleCount).toBe(2)
  })
})
