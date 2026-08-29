// How many graph slots fit the viewport, and how tall each one is so they fill
// it EXACTLY. This replaced the fixed panel heights (first 200px, rest 140px,
// map 240px): a fixed height means an arbitrary fraction of a graph at the
// bottom of any given window, and the point of this layout is that a
// screenshot at rest shows N whole graphs and nothing cropped. See
// ARCHITECTURE.md §7.
//
// Pure math in its own file, like domain/zoomDomain.js: setupTests.js pins
// every getBoundingClientRect, so an integration test cannot tell whether the
// layout arithmetic is right — this function is the testable surface.

// The nominal slot height is what a graph WANTS to be; the viewport decides
// what it gets. N = how many nominal slots (plus the gaps between them) fit,
// and then the N slots stretch to consume the leftover, so a slot is always in
// [nominal, 2·nominal + gap). §9's "panel heights reduced ~25% below 720px"
// carries over as a reduced nominal — still JS numbers, not a media query,
// because they end up in <ResponsiveContainer height> (useIsNarrow.js).
export const NOMINAL_SLOT_HEIGHT = 200
export const NARROW_NOMINAL_SLOT_HEIGHT = 150

// MUST equal --panel-gap in tokens.css — the exact-fill arithmetic subtracts
// the real gaps the flex column will render. The twin comment is on the token.
export const PANEL_GAP = 12

/**
 * @param {number} viewportHeight - window.innerHeight; the panels snap flush
 *   to the viewport top (the sticky header fades once scrolled), so nothing
 *   is subtracted.
 * @param {number} panelCount - metric panels + map panel currently rendered.
 * @param {{nominal?: number, gap?: number}} [opts]
 * @returns {{visibleCount: number, slotHeight: number}} slotHeight is
 *   deliberately fractional: visibleCount·slotHeight + (visibleCount−1)·gap
 *   === viewportHeight, and rounding would break that invariant.
 */
export function slotLayoutFor(viewportHeight, panelCount, { nominal = NOMINAL_SLOT_HEIGHT, gap = PANEL_GAP } = {}) {
  // N slots need N−1 gaps, so "how many fit" is solved on (H+gap)/(nominal+gap).
  // Clamped to at least 1 — a window shorter than one nominal slot still shows
  // one graph, filling it (that graph is simply short) — and to at most
  // panelCount, where the few panels there are stretch to fill. panelCount 0
  // still yields 1: nothing renders, and a division by zero helps nobody.
  const fit = Math.floor((viewportHeight + gap) / (nominal + gap))
  const visibleCount = Math.min(Math.max(fit, 1), Math.max(panelCount, 1))
  const slotHeight = (viewportHeight - (visibleCount - 1) * gap) / visibleCount
  return { visibleCount, slotHeight }
}
