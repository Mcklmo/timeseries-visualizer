// The derivative overlay's colour, shared by the mark and the control that
// switches it on so the two can never drift apart. A lighter step of the
// metric's own hue: ARCHITECTURE.md §9 allows one hue per metric, and a
// derivative IS that metric, seen as a rate. Lighter rather than darker
// because the ground is #12151a — it has to lift off it to be read at all.
//
// Deliberately NOT in metricRegistry.js, which keeps presentation out by
// convention (see STAT_DASH in MetricPanel.jsx and KIND_LABEL in
// StatCheckboxes.jsx, both of which say so explicitly).
//
// @param {object} metric - a metricRegistry entry
// @returns {string} a CSS colour value
export const derivativeStroke = (metric) => `color-mix(in oklab, ${metric.color} 72%, white)`
