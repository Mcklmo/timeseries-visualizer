// Sideways trackpad scroll pans the zoom window at constant width. That is the
// whole hook — it is what survived when the zoom gesture was removed from it.
//
// ZOOMING USED TO LIVE HERE, and was deliberately deleted rather than lost.
// This file was usePinchZoom: a two-finger pinch, with ctrl/⌘+wheel as the
// desktop equivalent. Both are gone. Dragging a window edge
// (ui/useEdgeDrag.js, ui/ZoomWindowOverlay.jsx) is now the only way to zoom,
// because the two collided on touch: a handle is a 44px hit strip with
// pointer-events over the plot, so a pinch landing one finger on it started an
// edge drag AND a pinch at once, and the handle's pointerdown bubbles natively
// to a listener on .chart-stack where React's stopPropagation cannot reach it.
// Refereeing two gestures was rejected in favour of having one. The edge drag
// grew continuous expansion at the plot edge (useEdgeDrag.js) to cover what
// pinching out used to do.
//
// A consequence worth stating: a two-finger pinch over the charts is now the
// BROWSER's page zoom, which this hook used to swallow at ≥2 touches. See
// .chart-stack's `touch-action: pan-y pinch-zoom` in styles/global.css.
//
// The division of labour is unchanged: this file owns *events and pixels only*.
// Fractions across the plot come from ui/chartGeometry.js and every domain
// decision from domain/zoomDomain.js, both of which are pure and unit-tested.
// Nothing here does arithmetic on a domain.
//
// Gestures deliberately NOT implemented (declined; see ARCHITECTURE.md §13):
// one-finger drag-to-pan, mouse click-and-drag-to-pan, double-tap-to-reset,
// long-press readout. One-finger drag-to-pan is now foreclosed permanently
// rather than merely declined: a one-finger horizontal swipe scrubs the
// crosshair (ui/useTouchScrub.js), and it clamps at the plot edge rather than
// pushing the window along, so one finger does exactly one thing.
import { useCallback, useEffect, useRef } from 'react'
import { isFullDomain, panByFraction, sameDomain, toWindowDelta } from '../domain/zoomDomain.js'
import { plotRectOf } from './chartGeometry.js'

// Wheel tuning. deltaY arrives in three different units depending on
// deltaMode, and Firefox in particular sends mode 1 with deltaY ≈ ±3 — without
// normalising, a sideways swipe there feels completely dead.
const WHEEL_LINE_HEIGHT_PX = 16
const WHEEL_PAGE_HEIGHT_PX = 400

/** Pixels of scroll intent behind one wheel delta, whatever unit it came in.
 *  Takes the delta rather than the event because both axes need the identical
 *  deltaMode handling — Firefox's line-mode deltas are just as real sideways. */
function wheelPixels(delta, deltaMode) {
  if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_PX
  if (deltaMode === 2) return delta * WHEEL_PAGE_HEIGHT_PX
  return delta
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

/**
 * @param {object} args
 * @param {unknown} args.domain - the current zoomDomain, i.e. THE WINDOW
 *   (sentinel or numeric). All the arithmetic below is about the window; the
 *   wider range actually plotted around it enters only through
 *   `windowFractions`.
 * @param {[number, number]} [args.windowFractions] - where the window's edges
 *   sit across the plot (domain/zoomDomain.js). Travel across the PLOT is
 *   re-expressed against the window with these before the pan runs. Defaults to
 *   the identity pair, which is exactly the unzoomed case — where there is
 *   nothing to pan anyway.
 * @param {[number, number] | null} args.fullExtent - the activity's true x-extent
 * @param {(domain: unknown) => void} args.onZoomChange
 * @param {number} [args.rightInset] - width of the derivative axis gutter, when the
 *   stack has one (ui/chartGeometry.js). The plot is that much narrower than the
 *   surface, and every fraction this hook solves is a fraction OF THE PLOT.
 * @returns {{ref: (node: Element | null) => void}}
 */
export function useWheelPan({ domain, windowFractions = [0, 1], fullExtent, onZoomChange, rightInset = 0 }) {
  // Every mutable input is routed through this one ref, and the ref callback
  // below keeps a `[]` dep array. THIS IS THE LOAD-BEARING STRUCTURAL
  // DECISION in the hook: `domain` changes on every animation frame of a live
  // edge drag, so a callback that closed over it directly would change identity
  // each frame and React would detach and re-attach the listener mid-gesture,
  // every frame. `rightInset` goes through the same ref for the same reason —
  // it changes on a checkbox rather than a frame, but closing over it would
  // re-key the callback and tear the listener down anyway. `windowFractions` is
  // a fresh array on every render of ChartStack, so it has even less business
  // in a dep array than the rest.
  const latest = useRef({ domain, windowFractions, fullExtent, onZoomChange, rightInset })
  useEffect(() => {
    latest.current = { domain, windowFractions, fullExtent, onZoomChange, rightInset }
  })

  const ref = useCallback((node) => {
    if (!node) return undefined

    function emit(next) {
      const { domain: current, onZoomChange: notify } = latest.current
      if (sameDomain(next, current)) return
      notify?.(next)
    }

    // A horizontal swipe (or Shift + scroll) slides the zoomed window sideways
    // at constant width.
    function handleWheel(e) {
      const { domain: current, fullExtent: extent, rightInset: inset, windowFractions: fractions } = latest.current
      // "When zoomed in" is the whole feature: with the full activity on screen
      // there is nowhere to pan to, and swiping there must keep its default
      // browser behaviour rather than being silently swallowed.
      if (!extent || isFullDomain(current)) return
      const pixels = panPixels(e)
      // A plain vertical wheel scrolls the page — deliberately NOT
      // preventDefault'd. The stack fills the viewport, so the cursor is over a
      // chart essentially always; swallowing that would make reaching the
      // footer impossible. Nothing here reads ctrlKey/metaKey any more either:
      // a trackpad pinch arrives as a ctrl+wheel and must now reach the browser
      // so it page-zooms like it does everywhere else.
      if (pixels === 0) return
      const plotRect = plotRectOf(node, inset)
      if (!plotRect) return
      // preventDefault ONLY once a pan is certain. It does double duty here: as
      // well as suppressing the default scroll, it is what stops Safari and
      // Chrome turning a horizontal swipe into a back-navigation, which would
      // throw away the loaded activity.
      e.preventDefault()
      // toWindowDelta, not a plain fraction: this is travel, not a position, and
      // it is what keeps finger travel and content travel 1:1 now that the plot
      // is wider than the window panByFraction scales by.
      const next = panByFraction(current, extent, toWindowDelta(pixels / plotRect.width, fractions))
      if (next !== null) emit(next)
    }

    // Non-passive, and that is the whole reason this is a native listener
    // rather than a React onWheel: React attaches wheel at the root as passive,
    // so preventDefault there is a silent no-op.
    node.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      node.removeEventListener('wheel', handleWheel)
    }
    // A CALLBACK ref, not an object ref + useEffect: ChartStack early-returns
    // null when there is no activity, so an effect keyed on [] would run once
    // against a div that doesn't exist, bail, and never re-run when the
    // activity arrives — the listener would silently never attach. React 19.2
    // runs the cleanup returned above when the node detaches.
  }, [])

  return { ref }
}
