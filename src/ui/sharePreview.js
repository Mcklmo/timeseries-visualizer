// The link-preview card: scrapers never run the app, so the sharer's browser
// draws the picture and uploads it beside the payload.
import { isMetricForSport, metricOrder, metricRegistry } from '../metrics/metricRegistry.js'

const WIDTH = 1200
const HEIGHT = 630
const MARGIN = 40
const HEADER = 70
const GAP = 12
const LABEL_WIDTH = 160

/** @returns {string|null} base64 PNG, or null where canvas is unavailable */
export function renderSharePreview(activity) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const css = getComputedStyle(document.documentElement)
    // 'var(--metric-pace)' -> the resolved colour; canvas cannot read custom properties.
    const color = (value) => css.getPropertyValue(value.replace(/^var\(|\)$/g, '')).trim()

    ctx.fillStyle = color('--bg')
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color('--text')
    ctx.font = '600 36px system-ui, sans-serif'
    ctx.fillText(activity.name || 'ActivityMaxxer', MARGIN, MARGIN + 20, WIDTH - 2 * MARGIN)

    const metrics = metricOrder
      .filter((id) => activity.availableMetrics.includes(id) && isMetricForSport(id, activity.sport))
      .map((id) => metricRegistry[id])
    const panelHeight = (HEIGHT - HEADER - 2 * MARGIN - GAP * (metrics.length - 1)) / metrics.length
    const plotLeft = MARGIN + LABEL_WIDTH
    const plotWidth = WIDTH - MARGIN - 20 - plotLeft

    metrics.forEach((metric, index) => {
      const top = MARGIN + HEADER + index * (panelHeight + GAP)
      ctx.fillStyle = color('--panel')
      ctx.fillRect(MARGIN, top, WIDTH - 2 * MARGIN, panelHeight)
      ctx.fillStyle = color(metric.color)
      ctx.font = '500 24px system-ui, sans-serif'
      ctx.fillText(metric.label, MARGIN + 20, top + panelHeight / 2)
      drawTrace(ctx, previewPoints(activity.samples, metric.accessor, plotWidth / 2), {
        left: plotLeft,
        top: top + 10,
        width: plotWidth,
        height: panelHeight - 20,
        invert: metric.invertAxis,
        color: color(metric.color),
      })
    })

    return canvas.toDataURL('image/png').split(',')[1] || null
  } catch {
    // A missing preview must never block the share itself.
    return null
  }
}

/**
 * Samples averaged into `buckets` time slots, as [x in 0..1, value]; a null
 * entry breaks the line (missing reading). `moving` is ignored, as in the charts:
 * an indoor ride with no distance is "paused" throughout.
 */
export function previewPoints(samples, accessor, buckets) {
  const total = samples[samples.length - 1].t || 1
  const points = []
  let slot = null
  let sum = 0
  let count = 0
  const flush = () => {
    if (count) points.push([(slot + 0.5) / buckets, sum / count])
    sum = count = 0
  }
  for (const sample of samples) {
    const value = accessor(sample)
    const next = Math.min(Math.floor((sample.t / total) * buckets), Math.floor(buckets) - 1)
    if (value == null) {
      flush()
      if (points.length && points[points.length - 1] !== null) points.push(null)
      continue
    }
    if (next !== slot) flush()
    slot = next
    sum += value
    count += 1
  }
  flush()
  return points
}

function drawTrace(ctx, points, { left, top, width, height, invert, color }) {
  const values = points.filter(Boolean).map((p) => p[1]).sort((a, b) => a - b)
  if (!values.length) return
  // Percentiles, not min/max: one walk break would flatten the whole pace trace.
  const low = values[Math.floor(values.length * 0.02)]
  const high = values[Math.floor((values.length - 1) * 0.98)]
  const span = high - low || 1

  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.beginPath()
  let penDown = false
  for (const point of points) {
    if (!point) {
      penDown = false
      continue
    }
    const unit = Math.min(1, Math.max(0, (point[1] - low) / span))
    const x = left + point[0] * width
    const y = top + (invert ? unit : 1 - unit) * height
    if (penDown) ctx.lineTo(x, y)
    else ctx.moveTo(x, y)
    penDown = true
  }
  ctx.stroke()
}
