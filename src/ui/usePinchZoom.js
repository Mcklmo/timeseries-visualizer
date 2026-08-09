// Two-finger pinch to zoom the x-domain, with ctrl/⌘+wheel as the desktop
// equivalent. This replaces Recharts' <Brush> on every viewport, not just on
// phones: its travellers are ~5px wide against a 44px touch floor, its drag
// handlers bind to window, and the gesture fights page scroll
// (ARCHITECTURE.md §13 Route B).
//
// The division of labour: this file owns *events and pixels only*. Fractions
// across the plot come from ui/chartGeometry.js and every domain decision from
// domain/zoomDomain.js, both of which are pure and unit-tested. Nothing here
// does arithmetic on a domain.
//
// Panning exists on both routes. On touch it arrives free from the anchored
// solve, since moving both fingers together leaves the solved width unchanged.
// On a trackpad there is no such gesture, so while zoomed a horizontal swipe —
// or Shift + scroll on hardware with no horizontal wheel — gets its own path
// through panByFraction. Both keep the window's width exactly.
//
// Gestures deliberately NOT implemented (declined; see ARCHITECTURE.md §13):
// one-finger drag-to-pan, mouse click-and-drag-to-pan, double-tap-to-reset,
// long-press readout. One-finger drag-to-pan is now foreclosed permanently
// rather than merely declined: a one-finger horizontal swipe scrubs the
// crosshair (ui/useTouchScrub.js), and it clamps at the plot edge rather than
// pushing the window along, so one finger does exactly one thing.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isFullDomain,
  panByFraction,
  pinchDomain,
  resolveDomain,
  valueAtFraction,
  zoomAtFraction,
} from '../domain/zoomDomain.js'
import { clampFraction, fractionAcross, plotRectOf } from './chartGeometry.js'

// Two fingers closer together than this can't specify a window steadily —
// tremor between adjacent fingertips would swing the span wildly. Enforced in
// PIXELS here (and as a fraction inside solveAnchoredDomain), because pixels
// are the physically meaningful quantity and don't change with plot width.
const MIN_POINTER_SEPARATION_PX = 16

// Wheel tuning. deltaY arrives in three different units depending on
// deltaMode, and Firefox in particular sends mode 1 with deltaY ≈ ±3 — without
// normalising, ctrl+wheel there feels completely dead.
const WHEEL_LINE_HEIGHT_PX = 16
const WHEEL_PAGE_HEIGHT_PX = 400
const WHEEL_SENSITIVITY = 0.01
const WHEEL_SCALE_LIMIT = 2

const HINT_DURATION_MS = 1500

/** Pixels of scroll intent behind one wheel delta, whatever unit it came in.
 *  Takes the delta rather than the event because both axes need the identical
 *  deltaMode handling — Firefox's line-mode deltas are just as real sideways. */
function wheelPixels(delta, deltaMode) {
  if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_PX
  if (deltaMode === 2) return delta * WHEEL_PAGE_HEIGHT_PX
  return delta
}

/** Per-event zoom factor: <1 zooms in (wheel/pinch up), >1 zooms out. Clamped
 *  so one violent flick can't jump from full to max zoom in a single frame. */
function wheelScale(e) {
  const scale = Math.exp(wheelPixels(e.deltaY, e.deltaMode) * WHEEL_SENSITIVITY)
  if (!Number.isFinite(scale)) return 1
  return Math.min(WHEEL_SCALE_LIMIT, Math.max(1 / WHEEL_SCALE_LIMIT, scale))
}

/** Signed pixels of horizontal intent, or 0 if this wheel event isn't one. */
function panPixels(e) {
  // Chrome swaps the axis itself under Shift; Firefox leaves the value in
  // deltaY. The `||` covers both without sniffing the browser.
  if (e.shiftKey) return wheelPixels(e.deltaY || e.deltaX, e.deltaMode)
  // DOMINANCE, not `deltaX !== 0`: a macOS two-finger scroll is always
  // slightly diagonal, so panning on any horizontal component at all would
  // make an ordinary vertical read-through jitter the window sideways.
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return 0
  return wheelPixels(e.deltaX, e.deltaMode)
}

function sameDomain(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return a[0] === b[0] && a[1] === b[1]
}

/**
 * @param {object} args
 * @param {unknown} args.domain - the current zoomDomain (sentinel or numeric)
 * @param {[number, number] | null} args.fullExtent - the activity's true x-extent
 * @param {(domain: unknown) => void} args.onZoomChange
 * @param {number} [args.rightInset] - width of the derivative axis gutter, when the
 *   stack has one (ui/chartGeometry.js). The plot is that much narrower than the
 *   surface, and every fraction this hook solves is a fraction OF THE PLOT.
 * @returns {{ref: (node: Element | null) => void, wheelHint: boolean}}
 */
export function usePinchZoom({ domain, fullExtent, onZoomChange, rightInset = 0 }) {
  const [wheelHint, setWheelHint] = useState(false)

  // Every mutable input is routed through this one ref, and the ref callback
  // below keeps a `[]` dep array. THIS IS THE LOAD-BEARING STRUCTURAL
  // DECISION in the hook: `domain` changes on every animation frame of a live
  // pinch, so a callback that closed over it directly would change identity
  // each frame and React would detach and re-attach all seven listeners
  // mid-gesture, every frame. `rightInset` goes through the same ref for the
  // same reason — it changes on a checkbox rather than a frame, but closing
  // over it would re-key the callback and tear the listeners down anyway.
  const latest = useRef({ domain, fullExtent, onZoomChange, rightInset })
  useEffect(() => {
    latest.current = { domain, fullExtent, onZoomChange, rightInset }
  })

  const gesture = useRef({
    /** @type {Map<number, number>} pointerId → clientX */
    pointers: new Map(),
    /** @type {{id: number, value: number, startFraction: number}[] | null} */
    anchors: null,
    /** @type {{left: number, width: number} | null} */
    plotRect: null,
    frame: 0,
    hintTimer: 0,
    hintShown: false,
    hasZoomed: false,
  })

  const ref = useCallback((node) => {
    if (!node) return undefined
    const g = gesture.current

    function emit(next) {
      const { domain: current, onZoomChange: notify } = latest.current
      if (sameDomain(next, current)) return
      g.hasZoomed = true
      notify?.(next)
    }

    // Fresh anchors whenever the pointer count settles at exactly two — on the
    // way up (fingers land) and on the way back down (a third finger lifts).
    // Re-arming rather than keeping the old anchors is what stops the chart
    // jumping when a finger is replanted mid-gesture.
    function arm() {
      const { domain: current, fullExtent: extent, rightInset: inset } = latest.current
      g.anchors = null
      if (g.pointers.size !== 2 || !extent) return
      const plotRect = plotRectOf(node, inset)
      if (!plotRect) return
      const resolved = resolveDomain(current, extent)
      g.plotRect = plotRect
      g.anchors = [...g.pointers.entries()]
        .map(([id, clientX]) => {
          // NOT clamped to [0,1]: a finger on the y-axis strip is a genuine
          // negative fraction. The solve extrapolates it correctly and
          // clampDomain fixes the result — clamping at capture time would lie
          // about where the finger is and make the anchor drift under it.
          const startFraction = fractionAcross(clientX, plotRect)
          return { id, startFraction, value: valueAtFraction(startFraction, resolved) }
        })
        // Ordered by START fraction, which is what makes solveAnchoredDomain's
        // signed separation check mean "the fingers crossed".
        .sort((p, q) => p.startFraction - q.startFraction)
    }

    function frameHandler() {
      g.frame = 0
      const { fullExtent: extent } = latest.current
      if (!g.anchors || !extent || !g.plotRect) return

      const live = g.anchors.map((anchor) => {
        const clientX = g.pointers.get(anchor.id)
        return clientX === undefined ? null : { anchor, clientX }
      })
      if (live.some((p) => p === null)) return

      const [a, b] = live
      if (b.clientX - a.clientX < MIN_POINTER_SEPARATION_PX) return

      const next = pinchDomain(
        { value: a.anchor.value, fraction: fractionAcross(a.clientX, g.plotRect) },
        { value: b.anchor.value, fraction: fractionAcross(b.clientX, g.plotRect) },
        extent,
      )
      // null means this frame couldn't specify a window (crossed or coincident
      // fingers). Hold the last good domain rather than emitting anything.
      if (next !== null) emit(next)
    }

    // Coalesced into one emission per frame: iOS ProMotion fires pointermove
    // at up to 120Hz, and each emission re-renders N LineCharts with
    // interval={0} axes. (getCoalescedEvents is the wrong tool here — we want
    // the newest position, not every intermediate one.)
    function scheduleFrame() {
      if (g.frame !== 0) return
      g.frame = requestAnimationFrame(frameHandler)
    }

    function handlePointerDown(e) {
      // A mouse cannot pinch, and staying out of its way leaves Recharts'
      // hover and tooltip bookkeeping completely untouched.
      if (e.pointerType === 'mouse') return
      g.pointers.set(e.pointerId, e.clientX)
      // Disarms at three or more, re-arms at exactly two.
      arm()
    }

    function handlePointerMove(e) {
      if (!g.pointers.has(e.pointerId)) return
      g.pointers.set(e.pointerId, e.clientX)
      if (g.anchors) scheduleFrame()
    }

    function handlePointerUp(e) {
      if (!g.pointers.delete(e.pointerId)) return
      arm()
    }

    function showHint() {
      // Once per mount, and never after a zoom has actually landed —
      // otherwise it fires on every ordinary scroll past the charts, which
      // fill the viewport.
      if (g.hintShown || g.hasZoomed) return
      g.hintShown = true
      setWheelHint(true)
      g.hintTimer = setTimeout(() => setWheelHint(false), HINT_DURATION_MS)
    }

    // A horizontal swipe (or Shift + scroll) slides the zoomed window sideways
    // at constant width. Returns false on every bail, so the caller can fall
    // through to the hint path exactly as if this had never run.
    function tryPan(e) {
      const { domain: current, fullExtent: extent, rightInset: inset } = latest.current
      // "When zoomed in" is the whole feature: with the full activity on screen
      // there is nowhere to pan to, and swiping there must keep its default
      // browser behaviour rather than being silently swallowed.
      if (!extent || isFullDomain(current)) return false
      const pixels = panPixels(e)
      if (pixels === 0) return false
      const plotRect = plotRectOf(node, inset)
      if (!plotRect) return false
      // preventDefault ONLY once a pan is certain. It does double duty here: as
      // well as suppressing the default scroll, it is what stops Safari and
      // Chrome turning a horizontal swipe into a back-navigation, which would
      // throw away the loaded activity.
      e.preventDefault()
      const next = panByFraction(current, extent, pixels / plotRect.width)
      if (next !== null) emit(next)
      return true
    }

    function handleWheel(e) {
      const { domain: current, fullExtent: extent, rightInset: inset } = latest.current
      // ⌘ as well as ctrl: a macOS trackpad pinch already arrives as a wheel
      // event with ctrlKey set, so Mac users get the phone's gesture for free.
      // Tested first, so ctrl + a diagonal scroll still zooms rather than pans.
      if (!e.ctrlKey && !e.metaKey) {
        if (tryPan(e)) return
        // Plain vertical wheel scrolls the page — deliberately NOT
        // preventDefault'd. The stack fills the viewport, so the cursor is over
        // a chart essentially always; if plain wheel zoomed, reaching the
        // footer would be impossible.
        showHint()
        return
      }
      if (!extent) return
      // This preventDefault is what stops the browser's own page zoom, and it
      // is impossible from a React onWheel — React attaches wheel at the root
      // as passive, so preventDefault there is a silent no-op. That, more than
      // touch, is the airtight argument for native listeners here.
      e.preventDefault()
      const plotRect = plotRectOf(node, inset)
      if (!plotRect) return
      // Clamped, unlike the pinch anchors: the cursor can sit out over the
      // axis gutter, and zooming about a point outside the plot reads as the
      // chart lurching sideways.
      const fraction = clampFraction(fractionAcross(e.clientX, plotRect))
      const next = zoomAtFraction(current, extent, fraction, wheelScale(e))
      if (next !== null) emit(next)
    }

    // Recharts binds React onTouchStart/onTouchMove on .recharts-wrapper to
    // drive the tooltip, so without this the crosshair skitters around under
    // a pinch. Stopping in the CAPTURE phase means the event never reaches
    // React's root delegation and those synthetic handlers never run. Single
    // touches pass through untouched, so tap-to-read still works.
    //
    // preventDefault on touchstart (not just touchmove) is the load-bearing
    // half: once the UA has committed to a scroll it fires touchcancel, and a
    // late preventDefault is ignored.
    function handleMultiTouch(e) {
      if (e.touches.length < 2) return
      e.preventDefault()
      e.stopPropagation()
    }

    node.addEventListener('pointerdown', handlePointerDown)
    node.addEventListener('wheel', handleWheel, { passive: false })
    node.addEventListener('touchstart', handleMultiTouch, { passive: false, capture: true })
    node.addEventListener('touchmove', handleMultiTouch, { passive: false, capture: true })
    // On window, not the node: a finger that slides off the chart mid-pinch
    // must keep driving it, and one released off-element must still disarm.
    // (setPointerCapture would be the other way to get this and is
    // deliberately not used — it's undefined in jsdom 30 so it would throw in
    // every chart test, the spec already applies implicit capture to touch
    // pointers, and explicit capture retargets events in ways that can confuse
    // Recharts' own hover bookkeeping.)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      node.removeEventListener('pointerdown', handlePointerDown)
      node.removeEventListener('wheel', handleWheel)
      node.removeEventListener('touchstart', handleMultiTouch, { capture: true })
      node.removeEventListener('touchmove', handleMultiTouch, { capture: true })
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      if (g.frame !== 0) cancelAnimationFrame(g.frame)
      if (g.hintTimer !== 0) clearTimeout(g.hintTimer)
      g.frame = 0
      g.hintTimer = 0
      g.pointers.clear()
      g.anchors = null
    }
    // A CALLBACK ref, not an object ref + useEffect: ChartStack early-returns
    // null when there is no activity, so an effect keyed on [] would run once
    // against a div that doesn't exist, bail, and never re-run when the
    // activity arrives — the listeners would silently never attach. React 19.2
    // runs the cleanup returned above when the node detaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ref, wheelHint }
}
