import { describe, it, expect } from 'vitest'
import { clearLayer, drawMarker, drawRoute, drawSegment } from './drawTrack.js'

// The same recording stub setupTests.js installs on HTMLCanvasElement, built
// standalone here so these stay plain unit tests with no DOM in them at all.
function recordingContext() {
  const calls = []
  const ctx = { calls, strokeStyle: '', fillStyle: '', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt' }
  for (const name of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'clearRect']) {
    ctx[name] = (...args) => calls.push({ name, args, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth })
  }
  return ctx
}

/** The path as ['moveTo'|'lineTo', x, y] triples — what actually got drawn. */
function path(ctx) {
  return ctx.calls.filter((c) => c.name === 'moveTo' || c.name === 'lineTo').map((c) => [c.name, ...c.args])
}

const fit = { scale: 100, offsetX: 10, offsetY: 20 }

function trackOf(points) {
  return {
    x: Float64Array.from(points, ([x]) => x),
    y: Float64Array.from(points, ([, y]) => y),
    bounds: { x0: 0, y0: 0, x1: 1, y1: 1 },
    fixCount: points.length,
  }
}

const style = { stroke: 'gray', width: 1.5 }

describe('drawRoute', () => {
  it('strokes the kept points through the fit transform', () => {
    const ctx = recordingContext()
    const track = trackOf([
      [0, 0],
      [0.5, 0.25],
    ])

    drawRoute(ctx, { track, indices: Int32Array.from([0, 1]), fit, style })

    expect(path(ctx)).toEqual([
      ['moveTo', 10, 20],
      ['lineTo', 60, 45],
    ])
  })

  it('draws only the indices it is given, in the order given', () => {
    const ctx = recordingContext()
    const track = trackOf([
      [0, 0],
      [0.1, 0],
      [0.2, 0],
    ])

    drawRoute(ctx, { track, indices: Int32Array.from([0, 2]), fit, style })

    expect(path(ctx)).toEqual([
      ['moveTo', 10, 20],
      ['lineTo', 30, 20],
    ])
  })

  it('applies the style at stroke time', () => {
    const ctx = recordingContext()
    drawRoute(ctx, {
      track: trackOf([
        [0, 0],
        [0.1, 0],
      ]),
      indices: Int32Array.from([0, 1]),
      fit,
      style: { stroke: 'rebeccapurple', width: 2.5 },
    })

    const stroke = ctx.calls.find((c) => c.name === 'stroke')
    expect(stroke.strokeStyle).toBe('rebeccapurple')
    expect(stroke.lineWidth).toBe(2.5)
  })

  // The canvas counterpart of `connectNulls={false}` on the charts. A receiver
  // that lost sky is a gap, not a straight line across a city.
  it('lifts the pen at a gap instead of drawing across it', () => {
    const ctx = recordingContext()
    const track = trackOf([
      [0, 0],
      [0.1, 0],
      [NaN, NaN],
      [0.8, 0],
      [0.9, 0],
    ])

    drawRoute(ctx, { track, indices: Int32Array.from([0, 1, 2, 3, 4]), fit, style })

    expect(path(ctx)).toEqual([
      ['moveTo', 10, 20],
      ['lineTo', 20, 20],
      ['moveTo', 90, 20], // a NEW subpath, not a lineTo from (20,20)
      ['lineTo', 100, 20],
    ])
  })

  it('rounds joins and caps, so a switchback grows no miter spike', () => {
    const ctx = recordingContext()
    drawRoute(ctx, {
      track: trackOf([
        [0, 0],
        [0.5, 0],
        [0, 0.001],
      ]),
      indices: Int32Array.from([0, 1, 2]),
      fit,
      style,
    })

    expect(ctx.lineJoin).toBe('round')
    expect(ctx.lineCap).toBe('round')
  })

  it('draws nothing at all for an empty index list', () => {
    const ctx = recordingContext()
    drawRoute(ctx, { track: trackOf([[0, 0]]), indices: Int32Array.from([]), fit, style })
    expect(ctx.calls).toHaveLength(0)
  })

  it('leaves the surrounding canvas state alone', () => {
    const ctx = recordingContext()
    drawRoute(ctx, {
      track: trackOf([
        [0, 0],
        [0.1, 0],
      ]),
      indices: Int32Array.from([0, 1]),
      fit,
      style,
    })

    expect(ctx.calls[0].name).toBe('save')
    expect(ctx.calls.at(-1).name).toBe('restore')
  })
})

describe('drawSegment', () => {
  const track = trackOf([
    [0, 0],
    [0.1, 0],
    [0.2, 0],
    [0.3, 0],
  ])
  const indices = Int32Array.from([0, 1, 2, 3])

  it('strokes a half-open range of the index list', () => {
    const ctx = recordingContext()
    drawSegment(ctx, { track, indices, fit, style, from: 1, to: 3 })

    expect(path(ctx)).toEqual([
      ['moveTo', 20, 20],
      ['lineTo', 30, 20],
    ])
  })

  it('clamps a range that runs off either end', () => {
    const ctx = recordingContext()
    drawSegment(ctx, { track, indices, fit, style, from: -5, to: 99 })
    expect(path(ctx)).toHaveLength(4)
  })

  it('draws nothing for an inverted or empty range', () => {
    const ctx = recordingContext()
    drawSegment(ctx, { track, indices, fit, style, from: 3, to: 1 })
    expect(ctx.calls).toHaveLength(0)
  })
})

describe('drawMarker', () => {
  it('fills a dot and rings it with the halo', () => {
    const ctx = recordingContext()
    drawMarker(ctx, { x: 40, y: 55, style: { fill: 'white', halo: 'black', radius: 4, haloWidth: 2 } })

    const arc = ctx.calls.find((c) => c.name === 'arc')
    expect(arc.args.slice(0, 3)).toEqual([40, 55, 4])
    // Fill first, then the ring on top of it — that order is what keeps the
    // marker's outer size fixed as the halo is tuned.
    expect(ctx.calls.map((c) => c.name)).toEqual(['save', 'beginPath', 'arc', 'fill', 'stroke', 'restore'])
    expect(ctx.calls.find((c) => c.name === 'stroke').strokeStyle).toBe('black')
  })

  it('draws nothing for a non-finite position', () => {
    const ctx = recordingContext()
    drawMarker(ctx, { x: NaN, y: 10, style: { fill: 'white', halo: 'black', radius: 4, haloWidth: 2 } })
    expect(ctx.calls).toHaveLength(0)
  })
})

describe('clearLayer', () => {
  // In CSS pixels, not device pixels: the canvases carry a DPR transform, so
  // clearing canvas.width × canvas.height would miss three quarters of a retina
  // panel and leave a trail of stale markers.
  it('clears in CSS pixels from the origin', () => {
    const ctx = recordingContext()
    clearLayer(ctx, { width: 800, height: 240 })
    expect(ctx.calls).toEqual([
      expect.objectContaining({ name: 'clearRect', args: [0, 0, 800, 240] }),
    ])
  })
})
