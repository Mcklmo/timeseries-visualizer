// The route, drawn on canvas at the top of the chart stack. Structurally
// parallel to MetricPanel: a head carrying the panel's name and its own
// settings, then the drawing area, inset so it lines up with the plot areas of
// the charts below it.
//
// FOUR DECISIONS ALREADY SETTLED — see ARCHITECTURE.md §7. Don't relitigate
// them from inside this file:
//
//  · **The map fits the whole route, once, and never re-fits.** Zooming the
//    charts brightens a sub-segment of a dimmed whole rather than moving the
//    map. That is what makes every per-frame cost here trivial: the projection
//    (domain/buildTrack.js), the decimation (domain/simplifyTrack.js) and the
//    tile set are all functions of the fit, so all three are resize-time work.
//  · **Input is slaved.** There is no independent pan or zoom, and no gesture
//    of its own: the zoom is dragging a window edge on a chart below, and this
//    panel just redraws the bright segment the shared zoomDomain names.
//  · **Hand-rolled canvas 2D.** No Leaflet, no MapLibre, no new runtime
//    dependency. The fixed fit is what makes that a few hundred lines rather
//    than a mapping library.
//  · **Three stacked canvases, not one.** See map/drawTrack.js: on one canvas a
//    hover frame would re-stroke the entire route.
//
// ⚠️ **This panel renders canvases, NOT a `.recharts-surface`.** That is load
// bearing and is the reason it is safe to put a panel above the charts at all:
// `plotRectOf` (chartGeometry.js) measures the FIRST `.recharts-surface` in the
// stack and applies that one rect to gestures anywhere on it, so the edge-drag
// and pan arithmetic still measures the first MetricPanel and is untouched by
// the map being above it. There is a system test pinning that rather than a
// memory of it. The one edge case: with every metric toggled off and only the
// map showing, there is no surface at all and both gestures no-op — which is
// already what a zero-panel stack does.
import { useCallback, useEffect, useId, useRef } from 'react'
import { indexAtX } from '../domain/sliceSamples.js'
import { keptIndexAtOrAfter, simplifyTrack } from '../domain/simplifyTrack.js'
import { resolveDomain } from '../domain/zoomDomain.js'
import { basemapOrder, basemapRegistry, DEFAULT_BASEMAP } from '../map/basemapRegistry.js'
import { clearLayer, drawMarker, drawRoute, drawSegment, drawTile } from '../map/drawTrack.js'
import { fitFor, viewBoundsOf } from '../map/fitBounds.js'
import { createTileLoader } from '../map/tileLoader.js'
import { tileRect, tilesCovering, tileZoomFor } from '../map/tileMath.js'
import { CHART_MARGIN, PLOT_INSET } from './chartGeometry.js'
import { currentCrosshair, subscribeCrosshair } from './crosshairBus.js'

/** Stroke weights. The window reads as the subject and the rest as context, so
 *  the bright segment is the heavier mark — the same figure/ground rule the
 *  derivative overlay follows against its metric line (§7). */
const ROUTE_WIDTH = 1.5
const WINDOW_WIDTH = 2.5

const MARKER_RADIUS = 4
const MARKER_HALO_WIDTH = 2

/**
 * Canvas cannot read a CSS custom property — `strokeStyle = 'var(--text-dim)'`
 * is silently ignored and the previous colour is kept, which is the worst
 * possible failure mode because the first draw of a session looks black on
 * black. So the tokens are resolved through getComputedStyle, once per redraw
 * and never per point.
 *
 * The fallbacks are NOT a second copy of tokens.css and must never become one.
 * They exist for a document with no stylesheet attached — jsdom under test — and
 * are deliberately generic keywords that could not be mistaken for the real
 * palette if one ever leaked into a browser. An empty string would be worse
 * than either: assigning '' to strokeStyle is a no-op, so the layer would paint
 * in whatever colour was last set.
 */
function resolveStyle(el) {
  const computed = getComputedStyle(el)
  const token = (name, fallback) => computed.getPropertyValue(name).trim() || fallback
  return {
    route: token('--text-dim', 'gray'),
    window: token('--metric-pace', 'blue'),
    marker: token('--text', 'white'),
    halo: token('--bg', 'black'),
  }
}

/**
 * Point one canvas at a CSS-pixel coordinate system on a device-pixel backing
 * store, and hand back its context.
 *
 * `canvas.width = cssW * dpr` sizes the pixels we actually paint; the transform
 * then lets every draw call above speak in CSS pixels. Without it a retina
 * display renders the route at half size in the top-left quarter of the panel.
 *
 * Assigning `width` also RESETS the transform, which is why setTransform comes
 * after and not before — reversing them is a silent no-op.
 *
 * @returns {CanvasRenderingContext2D|null} null when the browser refuses a
 *   context. Real browsers do, under memory pressure or with too many live
 *   contexts, and every caller has to survive it — a map that fails to draw is
 *   an empty panel, not a crash.
 */
function prepareLayer(canvas, width, height, dpr) {
  if (!canvas) return null
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/**
 * @param {object} props
 * @param {import('../domain/types.js').Activity} props.activity - `track` must be non-null;
 *   ChartStack does not render this panel otherwise
 * @param {'time'|'distance'} props.xMode
 * @param {unknown} props.zoomDomain
 * @param {[number, number]|null} props.fullExtent - the SAME extent the gesture
 *   solves against (StatsBasisContext), passed rather than recomputed so the
 *   bright window and the charts cannot disagree about where the edges are
 * @param {number} [props.rightInset] - the stack-wide derivative gutter
 * @param {number} props.height - the drawing area's height in CSS pixels, the
 *   map's counterpart to a MetricPanel's `<ResponsiveContainer height>`
 * @param {string} [props.basemap] - a map/basemapRegistry.js id. Defaults to
 *   'none', so a panel rendered without it issues no network request — the
 *   privacy default, which App.test.jsx pins mechanically.
 * @param {(id: string) => void} [props.onBasemapChange] - optional for the same
 *   reason MetricPanel's `onToggleStat` is: a panel rendered bare in a test is
 *   still a perfectly good map, the control simply does nothing.
 */
export function MapPanel({
  activity,
  xMode,
  zoomDomain,
  fullExtent,
  rightInset = 0,
  height,
  basemap = DEFAULT_BASEMAP,
  onBasemapChange,
}) {
  const track = activity.track
  const samples = activity.samples
  const provider = basemapRegistry[basemap] ?? basemapRegistry[DEFAULT_BASEMAP]
  const radioName = useId()

  const hostRef = useRef(null)
  const baseRef = useRef(null)
  const windowRef = useRef(null)
  const markerRef = useRef(null)

  // One loader for the panel's whole lifetime, so its LRU survives a resize, a
  // zoom, and switching the basemap off and back on. Lazily constructed in the
  // render body — the standard "useRef with an expensive initial value" shape —
  // which is safe because the factory only allocates two Maps and touches no
  // globals until a tile is actually requested (map/tileLoader.js).
  const loaderRef = useRef(null)
  if (loaderRef.current === null) loaderRef.current = createTileLoader()

  // Bumped on every relayout. A tile that was requested for a superseded fit
  // resolves eventually — the network does not care that the panel resized —
  // and drawing it would paint a tile at the wrong scale over the new map.
  // Comparing generations at arrival is what makes late tiles inert.
  const generationRef = useRef(0)

  // Everything a draw needs that is NOT React state: the measured size, the fit
  // transform, the decimated index list, the three contexts and the resolved
  // colours. A ref rather than state on purpose — writing any of this into
  // state would re-render the panel on every resize and, worse, invite the
  // marker to do the same on every hover frame. Nothing here is rendered.
  const layoutRef = useRef(null)

  // ——— the three layers, smallest first ———

  const paintMarker = useCallback(
    (pos) => {
      const layout = layoutRef.current
      if (!layout) return
      clearLayer(layout.marker, layout)
      if (!pos) return

      // Located by TIME, not by the x-axis mode. `t` is strictly the sample's
      // own clock and monotonic by the Sample contract, while `d` is flat
      // across a pause — a crosshair inside a two-minute stop would resolve to
      // the first sample of that stop rather than to the hovered one. Both
      // arrive on the bus, so this costs nothing.
      const i = indexAtX(samples, 't', pos.t)
      const x = track.x[i]
      const y = track.y[i]
      // No fix at that instant. Drawing nothing is the honest answer — the
      // route itself is already broken there — and is better than pinning the
      // marker to the last known position, which would look like the athlete
      // standing still.
      if (Number.isNaN(x) || Number.isNaN(y)) return

      drawMarker(layout.marker, {
        x: x * layout.fit.scale + layout.fit.offsetX,
        y: y * layout.fit.scale + layout.fit.offsetY,
        style: {
          fill: layout.style.marker,
          halo: layout.style.halo,
          radius: MARKER_RADIUS,
          haloWidth: MARKER_HALO_WIDTH,
        },
      })
    },
    [samples, track],
  )

  const paintWindow = useCallback(() => {
    const layout = layoutRef.current
    if (!layout) return
    clearLayer(layout.window, layout)
    if (!fullExtent) return

    // Unzoomed, the window IS the whole route, so this paints all of it bright
    // and the dim base never shows. That is deliberate: it keeps the base layer
    // a pure function of size and tiles, so a zoom change never touches it.
    const [x0, x1] = resolveDomain(zoomDomain, fullExtent)
    const xKey = xMode === 'distance' ? 'd' : 't'

    // Both are the first sample AT OR AFTER their edge, so `from` sits on or
    // just inside the left edge and needs one point before it, while `to`
    // already sits on or just past the right edge and only needs including.
    // Hence -1 and +1, not a symmetric pair.
    //
    // That overlap is deliberate on both counts: without it the bright segment
    // stops short of the dim route it continues, leaving a visible hairline
    // seam at each end — and a window deep enough to fall entirely between two
    // kept points would select fewer than two and stroke nothing at all.
    const from = indexAtX(samples, xKey, x0)
    const to = indexAtX(samples, xKey, x1)
    const start = Math.max(0, keptIndexAtOrAfter(layout.indices, from) - 1)
    const end = Math.min(layout.indices.length, keptIndexAtOrAfter(layout.indices, to) + 1)

    drawSegment(layout.window, {
      track,
      indices: layout.indices,
      fit: layout.fit,
      style: { stroke: layout.style.window, width: WINDOW_WIDTH },
      from: start,
      to: end,
    })
  }, [samples, track, xMode, zoomDomain, fullExtent])

  const paintBase = useCallback(() => {
    const layout = layoutRef.current
    if (!layout) return
    clearLayer(layout.base, layout)

    // Tiles first, route on top. Whatever has arrived is drawn and the rest is
    // simply absent — a half-loaded basemap is a route over a partly painted
    // ground, which is what every map does while it loads, rather than a blank
    // panel until the last tile lands.
    for (const tile of layout.tiles) {
      const bitmap = loaderRef.current.get(provider.id, tile)
      if (bitmap) drawTile(layout.base, { bitmap, rect: tileRect(tile, layout.fit) })
    }

    drawRoute(layout.base, {
      track,
      indices: layout.indices,
      fit: layout.fit,
      style: { stroke: layout.style.route, width: ROUTE_WIDTH },
    })
  }, [track, provider])

  // ——— measure, size, fit, decimate ———

  // The three paint functions, reachable from the resize and tile-arrival paths
  // WITHOUT those paths depending on their identity.
  //
  // This indirection is load-bearing, not ceremony. `paintWindow` changes
  // identity on every zoom frame; if `relayout` closed over it, `relayout`
  // would change too, its effect would re-run, and **every pinch frame would
  // re-measure the panel, re-run simplifyTrack over the whole track and
  // re-stroke the entire route** — silently, with the correct picture on
  // screen the whole time. A resize genuinely does need to repaint all three
  // layers at the new fit, so the call has to happen; it just must not be a
  // dependency. Kept in sync in an effect declared ABOVE the relayout effect,
  // so the ref is current before anything reads it, and seeded through
  // useRef's initial value for the mount pass.
  const paintWindowRef = useRef(paintWindow)
  const paintMarkerRef = useRef(paintMarker)
  const paintBaseRef = useRef(paintBase)
  useEffect(() => {
    paintWindowRef.current = paintWindow
    paintMarkerRef.current = paintMarker
    paintBaseRef.current = paintBase
  }, [paintWindow, paintMarker, paintBase])

  // Tiles land one at a time, and a full-route fit is ten to thirty of them —
  // several typically resolving within the same frame. Repainting per arrival
  // would re-stroke the route once per tile; coalescing to one repaint per
  // animation frame collapses that burst into a single pass. This is the layer
  // that genuinely needs rAF, unlike the zoom window below, whose only writer
  // is already frame-coalesced.
  const tileFrameRef = useRef(0)
  const scheduleBasePaint = useCallback(() => {
    if (tileFrameRef.current !== 0) return
    tileFrameRef.current = requestAnimationFrame(() => {
      tileFrameRef.current = 0
      paintBaseRef.current()
    })
  }, [])

  /** @returns {boolean} whether a new layout was actually built — the caller
   *  has to repaint the other two layers when one was, see the effect below. */
  const relayout = useCallback(() => {
    const host = hostRef.current
    if (!host) return false

    const rect = host.getBoundingClientRect()
    const width = Math.round(rect.width)
    const canvasHeight = Math.round(rect.height)
    if (!(width > 0) || !(canvasHeight > 0)) return false

    // Read inside the resize path rather than once at mount: this is what
    // covers dragging the window to a second monitor and browser zoom, both of
    // which change devicePixelRatio and both of which also fire a resize.
    const dpr = window.devicePixelRatio || 1

    // Nothing this layout is a function of has changed, so bail BEFORE
    // prepareLayer wipes three canvases and abort() cancels the tiles that are
    // on their way to them.
    //
    // This is the common path, not a rare one: a real ResizeObserver delivers
    // one callback the moment observe() is called whether or not anything
    // moved, so every mount and every basemap change used to run this twice.
    // The second pass cost a redundant simplifyTrack, three backing-store
    // resets and a full re-stroke — and, until tileLoader.abort() learned to
    // clear its dedupe map, it also killed the basemap outright.
    //
    // `track` belongs in here with the geometry: it feeds both the fit and the
    // decimation, and this panel is not remounted when a second activity is
    // loaded, so a same-size same-basemap swap would otherwise keep the old
    // route on screen.
    const previous = layoutRef.current
    if (
      previous &&
      previous.track === track &&
      previous.width === width &&
      previous.height === canvasHeight &&
      previous.dpr === dpr &&
      previous.providerId === provider.id
    ) {
      return false
    }

    const fit = fitFor(track.bounds, { width, height: canvasHeight })

    // Which tiles cover the CANVAS, not the route's own bbox: the fit centres
    // the route with padding, so the panel legitimately shows more world than
    // the route touches, and feeding it `track.bounds` would leave unpainted
    // margins around every map. 'none' resolves to no tiles at all, which is
    // what makes the private default free rather than merely quiet.
    const tiles = provider.tiles
      ? tilesCovering(
          viewBoundsOf(fit, width, canvasHeight),
          tileZoomFor(fit.scale, provider.tileSize, provider.maxZoom),
        )
      : []

    layoutRef.current = {
      width,
      height: canvasHeight,
      // Carried only so the short-circuit above can compare them. Everything
      // else in here is something a draw reads.
      dpr,
      track,
      providerId: provider.id,
      fit,
      // Once per resize, never per frame — the whole point of the fixed fit.
      indices: simplifyTrack(track, fit),
      tiles,
      style: resolveStyle(host),
      base: prepareLayer(baseRef.current, width, canvasHeight, dpr),
      window: prepareLayer(windowRef.current, width, canvasHeight, dpr),
      marker: prepareLayer(markerRef.current, width, canvasHeight, dpr),
    }

    generationRef.current += 1
    const generation = generationRef.current
    // Unconditional, before the loop below rather than inside it: anything
    // still in flight was requested for the fit — or the provider — we have
    // just replaced, so switching the basemap OFF (which leaves `tiles` empty
    // and the loop a no-op) has to cancel it too. The generation check below
    // would already make a late tile inert; aborting means we do not pay for
    // it either.
    loaderRef.current.abort()

    paintBase()

    for (const tile of tiles) {
      loaderRef.current.load(provider.id, tile).then((bitmap) => {
        if (bitmap && generationRef.current === generation) scheduleBasePaint()
      })
    }

    return true
  }, [track, provider, paintBase, scheduleBasePaint])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    // On MOUNT, lay out and paint the base only: the two effects below run on
    // this same pass and paint the window and the marker themselves, so doing
    // it here as well would draw each of them twice.
    //
    // On a LATER run — the basemap changed, or the activity did — that no
    // longer holds. relayout() reassigns `canvas.width` on all three layers,
    // which WIPES them, and a basemap change touches none of the dependencies
    // of the window or marker effects, so neither re-runs to restore its layer.
    // Left alone, switching the background on would blank the bright zoom
    // window and the crosshair dot until the next resize. (This was masked
    // until now by the ResizeObserver's initial callback repainting all three
    // by accident; the short-circuit in relayout() correctly removes that.)
    const hadLayout = layoutRef.current !== null
    if (relayout() && hadLayout) {
      paintWindowRef.current()
      paintMarkerRef.current(currentCrosshair())
    }

    // Resize: the fit, the decimation and all three backing stores are stale,
    // so every layer has to be repainted at the new geometry — through the refs
    // above, for the reason documented there. Gated on relayout() having done
    // real work, because a real ResizeObserver fires once on observe() whether
    // or not the element ever changed size.
    const observer = new ResizeObserver(() => {
      if (!relayout()) return
      paintWindowRef.current()
      paintMarkerRef.current(currentCrosshair())
    })
    observer.observe(host)

    // Called directly as well as observed because ResizeObserver's initial
    // callback is not something to depend on for a first paint: it is delivered
    // asynchronously in a browser, and the stub in setupTests.js fires it
    // synchronously, so without the direct call the first frame would be blank.
    return () => observer.disconnect()
  }, [relayout])

  // Deliberately NOT rAF-coalesced, despite this being the layer that redraws
  // during a live gesture. Every writer of zoomDomain — useEdgeDrag, and
  // useWheelPan through a wheel event — emits at most once per animation frame
  // already, so a second rAF here would buy nothing and cost a frame of latency
  // plus the cancellation bookkeeping to go with it.
  useEffect(() => {
    paintWindow()
  }, [paintWindow])

  // Imperative, and that is the point: a hover frame must not re-render
  // anything. See ui/crosshairBus.js for why this is not a context. The
  // subscribe replays the current position, which is also what paints the
  // marker on mount.
  useEffect(() => subscribeCrosshair(paintMarker), [paintMarker])

  // Unmount. Separate from the relayout effect above and with empty deps, so it
  // runs exactly once at teardown rather than on every basemap or track change:
  // aborting mid-session is the relayout path's job, and doing it here as well
  // would cancel the loads that path had just started.
  useEffect(() => {
    const loader = loaderRef.current
    return () => {
      loader.abort()
      if (tileFrameRef.current !== 0) cancelAnimationFrame(tileFrameRef.current)
    }
  }, [])

  return (
    <div className="map-panel" style={{ minHeight: height, '--plot-inset': `${PLOT_INSET}px` }}>
      {/* Mirrors MetricPanel's PanelHead, including the native <summary> unfold
          arrow, because per-graph settings live in that graph's own head — see
          §7 Route D. There is deliberately NO crosshair value slot: the app
          header's `12:05 · 2.34 km` already reports the position, and the map's
          own answer to "where was I" is the marker. */}
      <div className="map-panel__head">
        <details className="metric-settings">
          <summary className="metric-settings__summary">
            <span className="metric-readout">
              <span className="metric-readout__label">Route</span>
            </span>
          </summary>
          <div className="metric-settings__body">
            <fieldset className="basemap-control">
              <legend className="basemap-control__legend">Background</legend>
              {basemapOrder.map((id) => (
                <label key={id} className="basemap-option">
                  <input
                    type="radio"
                    // useId, not a literal: two radio groups sharing a name
                    // would behave as one, and several suites render more than
                    // one stack into the same document.
                    name={radioName}
                    value={id}
                    checked={provider.id === id}
                    onChange={() => onBasemapChange?.(id)}
                  />
                  {basemapRegistry[id].label}
                </label>
              ))}
            </fieldset>
            {/* The disclosure belongs where the choice is made, so it is here
                rather than behind a modal — and it is here rather than only on
                the About page because this is the one control in the app that
                turns a network request on. Same treatment as the feedback
                form's public-issue warning and the intervals.icu key notice:
                it must not read as a throwaway hint. */}
            <p className="basemap-control__notice">
              Off by default. With a background switched on, your browser asks activitymaxxer.com for map tiles by
              coordinate and this app passes the request on, so the tile provider never sees your IP address. Your
              activity file is still never sent anywhere.
            </p>
          </div>
        </details>
      </div>
      <div
        className="map-panel__canvases"
        ref={hostRef}
        style={{ height, '--plot-right-inset': `${CHART_MARGIN.right + rightInset}px` }}
      >
        {/* aria-hidden on all three: the route is decorative relative to the
            charts, which carry the same activity as real numbers, and there is
            no text alternative that would say more than the panel head does. */}
        <canvas className="map-panel__layer" ref={baseRef} aria-hidden="true" />
        <canvas className="map-panel__layer" ref={windowRef} aria-hidden="true" />
        <canvas className="map-panel__layer" ref={markerRef} aria-hidden="true" />
        {/* NOT optional and NOT collapsible — both OpenStreetMap's and CARTO's
            terms require the credit to be visible wherever their tiles are.
            Rendered from the registry entry rather than written out here, so a
            provider added later cannot arrive without one. */}
        {provider.attribution !== null && <p className="map-panel__attribution">{provider.attribution}</p>}
      </div>
    </div>
  )
}
