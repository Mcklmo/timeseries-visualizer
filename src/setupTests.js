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
//
// ⚠️ **observe() delivers one callback, because a real ResizeObserver does** —
// unconditionally, as soon as you observe an element, whether or not it ever
// changes size. A stub that never fired at all made every observer callback in
// the app dead code under test, and hid a bug that blanked the route map's
// basemap in every browser: MapPanel's second, observer-driven relayout aborted
// the tile requests its first one had just started (see map/tileLoader.js
// `abort`). Firing here is what makes that class of bug visible to the suite.
//
// The one liberty taken is timing: a browser delivers the callback
// asynchronously, before the next paint. Firing synchronously inside observe()
// keeps it inside the effect — and therefore inside React's act() — which an
// await-free test can actually observe. Nothing in the app depends on the
// callback landing in a later task.
class ResizeObserverStub {
  constructor(callback) {
    this._callback = callback
  }

  observe(target) {
    // Entries, not a bare call: ResponsiveContainer reads `contentRect` off
    // them. getBoundingClientRect is pinned to 800×200 below.
    this._callback([{ target, contentRect: target?.getBoundingClientRect?.() }], this)
  }

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

// jsdom implements no matchMedia at all, and useIsNarrow() — now only
// ChartStack's panel heights — calls it during render, so without this every
// chart test throws at once. See ARCHITECTURE.md §13 Route A.
//
// `matches: false` is load-bearing, not just a convenient default: it means
// "not narrow", which is the branch every existing panel-height assertion
// expects. A test wanting the narrow branch reassigns window.matchMedia itself
// and restores it in an afterEach.
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
//
// It is also what makes the map panel's canvas sizing deterministic: MapPanel
// measures its own host the same way, so every test draws into an 800×200 area.
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 800, width: 800, height: 200, toJSON() {} }
}

// jsdom implements neither URL.createObjectURL nor URL.revokeObjectURL (both
// are `undefined`), which is everything lib/downloadBytes.js is built out of —
// `Blob` and HTMLAnchorElement.prototype.click *do* exist, so the rest of that
// path works untouched.
//
// Same philosophy as the canvas stub below: returning a working stub rather
// than letting the code take an early-return branch is the point. The real
// download path then runs under test, and because this one RECORDS what it was
// handed, a test can assert on the actual Blob — its size, its bytes, its type
// — rather than merely that a function was called. `revoked` is recorded too,
// so the leak this app would otherwise have (a live object URL pinning a whole
// FIT file for the session) stays assertable.
const objectUrls = []
URL.createObjectURL = function (blob) {
  const url = `blob:mock/${objectUrls.length}`
  objectUrls.push({ url, blob, revoked: false })
  return url
}
URL.revokeObjectURL = function (url) {
  const entry = objectUrls.find((e) => e.url === url)
  if (entry) entry.revoked = true
}
// Tests read this rather than spying — it survives the module-level assignment
// above and needs no per-suite setup. Emptied between tests for the same reason
// the DOM is: jsdom's environment is per *file*, so one test's download would
// otherwise still be the "last" one the next test reads.
globalThis.__objectUrls = objectUrls
afterEach(() => {
  objectUrls.length = 0
})

// jsdom implements no canvas at all: `getContext('2d')` returns null and logs
// "Not implemented" noise. Neither `canvas` (a native build) nor
// `vitest-canvas-mock` is installed, and neither is worth its weight here —
// ui/MapPanel.jsx and map/drawTrack.js are written around an INJECTED context
// precisely so a stub of this size can stand in.
//
// Returning a working stub rather than letting MapPanel take its `if (!ctx)
// return` branch is the point: the real draw path then executes under test, so
// a test can assert that the route was stroked, that a gap lifted the pen, and
// that the marker moved — against the actual calls the production code makes.
//
// Every call is recorded WITH the style state in effect at the time, because
// the interesting assertions are about which layer was painted in which colour
// and the style properties are mutated between calls (`drawSegment` sets
// strokeStyle, then strokes). Reading `ctx.strokeStyle` afterwards would only
// ever report the last value set.
const CANVAS_2D_METHODS = [
  'save',
  'restore',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'rect',
  'stroke',
  'fill',
  'clearRect',
  'setTransform',
  'drawImage',
]

HTMLCanvasElement.prototype.getContext = function (contextType) {
  if (contextType !== '2d') return null
  // Cached per element, matching the real API: getContext returns the SAME
  // context object every time, and a fresh stub per call would drop the
  // recorded history a test is about to read.
  if (!this._recordingContext2d) {
    const calls = []
    const ctx = {
      canvas: this,
      calls,
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineJoin: 'miter',
      lineCap: 'butt',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    }
    for (const name of CANVAS_2D_METHODS) {
      ctx[name] = (...args) => {
        calls.push({ name, args, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle, lineWidth: ctx.lineWidth })
      }
    }
    this._recordingContext2d = ctx
  }
  return this._recordingContext2d
}
