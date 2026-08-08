import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// With `globals: false` in vite.config.js, @testing-library/react's automatic
// afterEach cleanup never registers (it looks for a global `afterEach`) — so
// without this, DOM from one test leaks into the next within the same file.
//
// sessionStorage is cleared for the same reason: jsdom's environment is per
// *file*, not per test, and ChartViewContext now persists the chart view per
// activity key (state/viewPrefsStore.js). Several suites reuse one fixture
// activity across many tests, so without this a view toggled in one test is
// restored into the next one's fresh render.
afterEach(() => {
  cleanup()
  try {
    sessionStorage.clear()
  } catch {
    // Same tolerance the store itself has for unavailable storage.
  }
})

// Recharts' ResponsiveContainer needs ResizeObserver and real layout, neither
// of which jsdom provides. Stub it so charts mount with a fixed size in tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub

// jsdom 30 still doesn't implement <dialog>'s showModal()/close(), so the
// feedback dialog would throw on open. It *does* apply the UA
// `dialog:not([open]) { display: none }` rule and map <dialog> to role
// "dialog" via aria-query, so toggling the `open` attribute is enough for
// role-based queries and visibility assertions to behave. `close()` no-ops
// when already closed, matching the real API — otherwise FeedbackDialog's
// initial closed render would fire a spurious `close` event.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

// jsdom implements no matchMedia at all, and useIsNarrow() (ChartStack's
// panel heights, ControlPanel's collapse) calls it during render — so without
// this every chart test throws at once. See ARCHITECTURE.md §13 Route A.
//
// `matches: false` is load-bearing, not just a convenient default: it means
// "not narrow", which is the branch every existing panel-height assertion and
// every ControlPanel role query already expects (a closed <details> hides its
// contents from getByRole). A test wanting the narrow branch reassigns
// window.matchMedia itself and restores it in an afterEach.
window.matchMedia = function (query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  }
}

// ResponsiveContainer measures its container with getBoundingClientRect on
// mount to turn width="100%" into a pixel width; jsdom never computes real
// layout, so every rect is 0 by default and charts render at 0x0 with none
// of their children (axes, lines, cursor) in the DOM. A fixed non-zero rect
// lets Recharts lay out real, assertable SVG geometry in every test.
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 800, width: 800, height: 200, toJSON() {} }
}
