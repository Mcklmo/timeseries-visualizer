// Everything that puts route ink on a canvas. Pure functions over an injected
// 2D-context-like object — no DOM lookups, no React, no measurement.
//
// **WHY THE CONTEXT IS A PARAMETER.** Two reasons, and the second is the one
// that made it non-negotiable. It mirrors the `fetchImpl` and storage injection
// this codebase already uses at every other seam (worker/lib/stravaProxy.js,
// state/viewPrefsStore.js). And jsdom implements no canvas at all — neither
// `canvas` nor `vitest-canvas-mock` is installed, and `getContext('2d')`
// returns null — so a function that fetched its own context would be untestable
// without a native build step. Given the context, a recording stub of about
// thirty lines (src/setupTests.js) makes the real draw path assertable.
//
// The three layers these draw onto are separate canvases, and that split IS the
// performance design (ARCHITECTURE.md §7):
//
//   base    tiles + the whole route, dimmed   redrawn on resize / tile arrival
//   window  the zoom window's sub-segment     redrawn when zoomDomain changes
//   marker  the crosshair dot                 redrawn every hover frame
//
// On one canvas, moving the marker would mean re-stroking the entire route at
// mouse-move rate. Here a hover frame is a clearRect plus one arc on a layer
// that holds nothing else.

/**
 * Stroke a range of a Track through a fit transform.
 *
 * `from`/`to` index `indices`, NOT the track — they are positions in the
 * simplified list of points to draw (domain/simplifyTrack.js), and the values
 * stored there are the original sample indices.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} args
 * @param {import('../domain/types.js').Track} args.track
 * @param {Int32Array} args.indices - from simplifyTrack
 * @param {{scale: number, offsetX: number, offsetY: number}} args.fit
 * @param {{stroke: string, width: number}} args.style
 * @param {number} [args.from] - inclusive
 * @param {number} [args.to] - exclusive
 */
export function drawSegment(ctx, { track, indices, fit, style, from = 0, to = indices.length }) {
  if (!ctx || !track || indices.length === 0) return

  const start = Math.max(0, Math.min(from, indices.length))
  const end = Math.max(start, Math.min(to, indices.length))
  if (end - start < 1) return

  ctx.save()
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = style.width
  // Round joins and caps, not the default miter/butt. A GPS trace changes
  // direction sharply and often; miter joins on a near-reversal (a switchback,
  // a turnaround at the end of an out-and-back) shoot a spike out to the miter
  // limit, which reads as stray whiskers along the route.
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()

  // `penDown` rather than "is this the first point": a NaN run lifts the pen
  // mid-segment, and the point after it must start a NEW subpath. This is the
  // canvas equivalent of `connectNulls={false}` on the charts — a receiver that
  // lost sky for ten minutes is a gap, not a straight line across a city.
  let penDown = false
  for (let k = start; k < end; k += 1) {
    const i = indices[k]
    const px = track.x[i] * fit.scale + fit.offsetX
    const py = track.y[i] * fit.scale + fit.offsetY

    if (Number.isNaN(px) || Number.isNaN(py)) {
      penDown = false
      continue
    }
    if (penDown) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
    penDown = true
  }

  ctx.stroke()
  ctx.restore()
}

/**
 * The whole route. A named wrapper rather than a call with the range left off,
 * because "draw everything, dimmed" and "draw this window, bright" are the two
 * things the panel actually does and they read better named.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{track: import('../domain/types.js').Track, indices: Int32Array,
 *          fit: {scale: number, offsetX: number, offsetY: number},
 *          style: {stroke: string, width: number}}} args
 */
export function drawRoute(ctx, args) {
  drawSegment(ctx, args)
}

/**
 * The crosshair's position on the route.
 *
 * A filled dot inside a ring of the panel's own ground colour. The ring is not
 * decoration: the marker has to read against a dimmed route, a bright one, and
 * — once the basemap is on — an arbitrary photograph of a city, and a bare dot
 * disappears into at least one of those. A halo in the background colour
 * separates it from all three without needing to know what is underneath.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} args
 * @param {number} args.x - canvas pixels
 * @param {number} args.y
 * @param {{fill: string, halo: string, radius: number, haloWidth: number}} args.style
 */
export function drawMarker(ctx, { x, y, style }) {
  if (!ctx || !Number.isFinite(x) || !Number.isFinite(y)) return

  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, style.radius, 0, Math.PI * 2)
  ctx.fillStyle = style.fill
  ctx.fill()
  // Stroked AFTER the fill and centred on the same circle, so the ring eats
  // half its width into the dot rather than growing it — the marker's outer
  // size stays `radius + haloWidth/2` however the halo is tuned.
  ctx.lineWidth = style.haloWidth
  ctx.strokeStyle = style.halo
  ctx.stroke()
  ctx.restore()
}

/**
 * One basemap tile, under the route.
 *
 * Positions are rounded and the size is grown by a pixel. Tile edges land on
 * fractional coordinates at almost every fit, and a canvas asked to draw two
 * adjacent images at x = 100.4 and x = 356.4 antialiases both outer edges —
 * which reads as a pale grid of hairline seams across the whole map, the single
 * most recognisable "hand-rolled tile layer" artefact there is. The overlap
 * costs under a pixel of scale error per tile and does not accumulate, since
 * each tile's rect is computed from its own coordinates rather than from its
 * neighbour's.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{bitmap: CanvasImageSource, rect: {x: number, y: number, size: number}}} args
 */
export function drawTile(ctx, { bitmap, rect }) {
  if (!ctx || !bitmap) return
  const size = Math.ceil(rect.size) + 1
  ctx.drawImage(bitmap, Math.round(rect.x), Math.round(rect.y), size, size)
}

/**
 * Wipe a layer. Trivial, and here rather than inline at the four call sites so
 * that every one of them clears in device-independent CSS pixels — the
 * canvases carry a DPR transform (`setTransform(dpr, …)`), so clearing
 * `canvas.width` × `canvas.height` would miss all but the top-left quarter on a
 * retina display, leaving a stale marker smeared across three quarters of the
 * panel.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{width: number, height: number}} size - CSS pixels
 */
export function clearLayer(ctx, { width, height }) {
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)
}
