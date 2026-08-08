// The derivative overlay's colour, shared by the mark and the control that
// switches it on so the two can never drift apart. A fixed perceptual step
// away from the metric's own hue, in whichever direction that hue has headroom:
// ARCHITECTURE.md §9 allows one hue per metric, and a derivative IS that
// metric, seen as a rate. Lighter for the four mid-lightness hues, since the
// ground is #12151a and the line has to lift off it to be read at all; darker
// for amber, which is already near the top of the lightness range and has
// nowhere lighter to go (see STEP_DARKER below).
//
// Deliberately NOT in metricRegistry.js, which keeps presentation out by
// convention (see STAT_DASH in MetricPanel.jsx and KIND_LABEL in
// StatCheckboxes.jsx, both of which say so explicitly).
//
// Hues with no headroom left toward white, which step darker instead. Amber is
// at oklab L 0.880 — mixing 72% toward white moves it 0.034, against 0.099 for
// heart rate's #ef476f at L 0.648, and the two power lines came out 1.1:1 apart.
// 80% toward black lands on #be9b4a: ΔL 0.176, still 6.9:1 on the #12151a
// ground, so 1.25px reads fine. Darker also puts power's figure/ground the right
// way up — under the white-mix rule EVERY metric's derivative outshines the main
// line it annotates (power 14.2:1 vs 12.7:1 against the ground).
const STEP_DARKER = new Set(['power'])

// @param {object} metric - a metricRegistry entry
// @returns {string} a CSS colour value
export const derivativeStroke = (metric) =>
  STEP_DARKER.has(metric.id)
    ? `color-mix(in oklab, ${metric.color} 80%, black)`
    : `color-mix(in oklab, ${metric.color} 72%, white)`
