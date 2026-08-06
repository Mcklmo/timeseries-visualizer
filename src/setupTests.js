import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// With `globals: false` in vite.config.js, @testing-library/react's automatic
// afterEach cleanup never registers (it looks for a global `afterEach`) — so
// without this, DOM from one test leaks into the next within the same file.
afterEach(cleanup)

// Recharts' ResponsiveContainer needs ResizeObserver and real layout, neither
// of which jsdom provides. Stub it so charts mount with a fixed size in tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub

// ResponsiveContainer measures its container with getBoundingClientRect on
// mount to turn width="100%" into a pixel width; jsdom never computes real
// layout, so every rect is 0 by default and charts render at 0x0 with none
// of their children (axes, lines, cursor) in the DOM. A fixed non-zero rect
// lets Recharts lay out real, assertable SVG geometry in every test.
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 800, width: 800, height: 200, toJSON() {} }
}
