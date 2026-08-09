// The map panel draws through the recording 2D-context stub in setupTests.js,
// so these assert against the calls the production draw path actually makes —
// not against a mock of it. jsdom computes no layout, so every element measures
// 800×200 (setupTests.js again), which is what makes the pixel numbers below
// deterministic.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildTrack } from '../domain/buildTrack.js'
import { fullDomain } from '../domain/zoomDomain.js'
import { publishCrosshair, resetCrosshairBus } from './crosshairBus.js'
import { MapPanel } from './MapPanel.jsx'

afterEach(() => resetCrosshairBus())

// A short straight run east, one sample every 10 s. Straight so that a
// sub-range of it is trivially identifiable by its endpoints.
const LATS = [55, 55, 55, 55, 55]
const LONS = [12, 12.01, 12.02, 12.03, 12.04]

function fixture({ gapAt = null } = {}) {
  const trackpoints = LATS.map((lat, i) => ({
    time: new Date(i * 10_000),
    lat: i === gapAt ? undefined : lat,
    lon: i === gapAt ? undefined : LONS[i],
    heartRateBpm: 140,
  }))
  return {
    id: 'map-fixture',
    sport: 'running',
    samples: LATS.map((_, i) => ({ t: i * 10, d: i * 100, heartRate: 140, moving: true })),
    availableMetrics: ['heartRate'],
    track: buildTrack(trackpoints),
  }
}

const DEFAULTS = {
  xMode: 'time',
  zoomDomain: fullDomain(),
  fullExtent: [0, 40],
  height: 240,
}

function renderPanel(props = {}) {
  const activity = props.activity ?? fixture()
  const result = render(<MapPanel {...DEFAULTS} activity={activity} {...props} />)
  return { ...result, activity }
}

/** The three layers, in the order MapPanel declares them. */
function layers(container) {
  return [...container.querySelectorAll('canvas')].map((c) => c.getContext('2d'))
}

const [BASE, WINDOW, MARKER] = [0, 1, 2]

function path(ctx) {
  return ctx.calls.filter((c) => c.name === 'moveTo' || c.name === 'lineTo').map((c) => [c.name, ...c.args])
}

describe('MapPanel', () => {
  it('renders three stacked canvases — base, window, marker', () => {
    const { container } = renderPanel()
    expect(container.querySelectorAll('.map-panel__layer')).toHaveLength(3)
  })

  it('strokes the whole route onto the base layer', () => {
    const { container } = renderPanel()
    expect(path(layers(container)[BASE])).toHaveLength(LATS.length)
  })

  // The route is a straight west-to-east line, so a correct fit puts it on one
  // horizontal row spanning the panel's width less the padding. This is the
  // assertion that would catch a transposed or mirrored projection.
  it('fits the route across the drawing area, padded off the edges', () => {
    const { container } = renderPanel()
    const points = path(layers(container)[BASE])

    const xs = points.map(([, x]) => x)
    const ys = points.map(([, , y]) => y)
    expect(Math.min(...xs)).toBeCloseTo(8, 6) // DEFAULT_PADDING
    expect(Math.max(...xs)).toBeCloseTo(792, 6)
    // Same latitude throughout, and vertically centred in the 200px host.
    expect(new Set(ys.map((y) => Math.round(y * 1e6)))).toHaveProperty('size', 1)
    expect(ys[0]).toBeCloseTo(100, 6)
  })

  it('sizes the backing store for the device pixel ratio', () => {
    const { container } = renderPanel()
    const canvas = container.querySelector('canvas')
    // devicePixelRatio is 1 in jsdom, so the backing store matches the measured
    // CSS size; the transform is what proves the DPR path ran at all.
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(200)
    const setTransform = canvas.getContext('2d').calls.find((c) => c.name === 'setTransform')
    expect(setTransform.args).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('breaks the stroke where the recording lost its fix', () => {
    const { container } = renderPanel({ activity: fixture({ gapAt: 2 }) })
    const points = path(layers(container)[BASE])

    // Two subpaths, not one: the pen lifts at the gap rather than drawing a
    // straight line across it.
    expect(points.filter(([kind]) => kind === 'moveTo')).toHaveLength(2)
  })

  describe('the zoom window', () => {
    it('paints the whole route bright while unzoomed', () => {
      const { container } = renderPanel()
      expect(path(layers(container)[WINDOW])).toHaveLength(LATS.length)
    })

    it('paints only the window while zoomed', () => {
      const { container } = renderPanel({ zoomDomain: [10, 20] })
      const points = path(layers(container)[WINDOW])

      // Samples 1 and 2 are in the window; the segment is widened by one kept
      // point on each side so it meets the dim route with no hairline gap.
      expect(points.length).toBeGreaterThanOrEqual(2)
      expect(points.length).toBeLessThan(LATS.length)
    })

    it('follows the distance axis when the charts are in distance mode', () => {
      const { container } = renderPanel({ xMode: 'distance', fullExtent: [0, 400], zoomDomain: [0, 100] })
      const points = path(layers(container)[WINDOW])
      expect(points.length).toBeLessThan(LATS.length)
    })

    it('repaints the window without touching the base layer', () => {
      const { container, rerender, activity } = renderPanel()
      const [base, windowLayer] = layers(container)
      const baseCallsBefore = base.calls.length

      rerender(<MapPanel {...DEFAULTS} activity={activity} zoomDomain={[10, 20]} />)

      // The whole point of the three-layer split: a zoom change re-strokes a
      // sub-range on one layer and leaves the route it sits on alone.
      expect(base.calls).toHaveLength(baseCallsBefore)
      expect(windowLayer.calls.filter((c) => c.name === 'clearRect').length).toBeGreaterThan(1)
    })
  })

  describe('the crosshair marker', () => {
    it('draws nothing at rest', () => {
      const { container } = renderPanel()
      expect(layers(container)[MARKER].calls.filter((c) => c.name === 'arc')).toHaveLength(0)
    })

    it('draws the marker where the hovered sample is', () => {
      const { container } = renderPanel()
      act(() => publishCrosshair({ t: 20, d: 200 }))

      const arc = layers(container)[MARKER].calls.findLast((c) => c.name === 'arc')
      // Sample 2 of 5 on a straight route: halfway across the padded width.
      expect(arc.args[0]).toBeCloseTo(400, 6)
      expect(arc.args[1]).toBeCloseTo(100, 6)
    })

    it('moves the marker as the crosshair moves, and clears it when it leaves', () => {
      const { container } = renderPanel()
      const marker = layers(container)[MARKER]

      act(() => publishCrosshair({ t: 0, d: 0 }))
      const first = marker.calls.findLast((c) => c.name === 'arc').args[0]
      act(() => publishCrosshair({ t: 40, d: 400 }))
      const second = marker.calls.findLast((c) => c.name === 'arc').args[0]
      expect(second).toBeGreaterThan(first)

      act(() => publishCrosshair(null))
      const lastCall = marker.calls.at(-1)
      expect(lastCall.name).toBe('clearRect')
    })

    // Nothing may re-render per hover frame — that is the whole reason the bus
    // is not a context (ui/crosshairBus.js). The base layer is the witness: a
    // re-render would run relayout and re-stroke the route.
    it('re-renders nothing when the crosshair moves', () => {
      const { container } = renderPanel()
      const base = layers(container)[BASE]
      const before = base.calls.length

      act(() => publishCrosshair({ t: 10, d: 100 }))
      act(() => publishCrosshair({ t: 20, d: 200 }))
      act(() => publishCrosshair({ t: 30, d: 300 }))

      expect(base.calls).toHaveLength(before)
    })

    it('draws no marker at an instant with no fix', () => {
      const { container } = renderPanel({ activity: fixture({ gapAt: 2 }) })
      const marker = layers(container)[MARKER]

      act(() => publishCrosshair({ t: 20, d: 200 }))

      // Cleared, then nothing — pinning the marker to the last known position
      // would look like the athlete standing still.
      expect(marker.calls.filter((c) => c.name === 'arc')).toHaveLength(0)
      expect(marker.calls.at(-1).name).toBe('clearRect')
    })

    it('replays the current crosshair to a panel that mounts mid-hover', () => {
      publishCrosshair({ t: 20, d: 200 })
      const { container } = renderPanel()
      expect(layers(container)[MARKER].calls.filter((c) => c.name === 'arc')).toHaveLength(1)
    })
  })

  // The head mirrors MetricPanel's, minus the crosshair value slot: the app
  // header already reports the position and the map's own answer is the marker.
  it('names the panel and carries no crosshair value slot', () => {
    const { container } = renderPanel()
    expect(container.querySelector('.map-panel__head .metric-readout__label').textContent).toBe('Route')
    expect(container.querySelector('.map-panel .crosshair-slot')).toBeNull()
  })

  // The drawing area lines up with the plot areas of the charts below it, from
  // the same constants the pinch gesture subtracts (ui/chartGeometry.js).
  it('insets the canvases to the charts’ plot area', () => {
    const { container } = renderPanel({ rightInset: 44 })
    const host = container.querySelector('.map-panel__canvases')
    expect(container.querySelector('.map-panel').style.getPropertyValue('--plot-inset')).toBe('60px')
    expect(host.style.getPropertyValue('--plot-right-inset')).toBe('56px') // CHART_MARGIN.right + rightInset
  })

  describe('the basemap', () => {
    /** Stubs the two globals the tile path uses, so the REAL loader runs.
     *  `createImageBitmap` does not exist in jsdom at all. */
    function stubTileNetwork() {
      const fetchSpy = vi.fn(async () => ({ ok: true, blob: async () => ({}) }))
      vi.stubGlobal('fetch', fetchSpy)
      vi.stubGlobal('createImageBitmap', async () => ({ close() {} }))
      return fetchSpy
    }

    afterEach(() => vi.unstubAllGlobals())

    // THE privacy default, pinned here as well as in App.test.jsx: a map panel
    // that mounts on its own must reach the network for nothing.
    it('issues no request at all while the basemap is off', () => {
      const fetchSpy = stubTileNetwork()
      renderPanel()
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('shows no attribution while no tiles are displayed', () => {
      const { container } = renderPanel()
      expect(container.querySelector('.map-panel__attribution')).toBeNull()
    })

    it('asks this app’s own origin for tiles, never a tile host', async () => {
      const fetchSpy = stubTileNetwork()
      renderPanel({ basemap: 'standard' })

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      for (const [url] of fetchSpy.mock.calls) {
        expect(url).toMatch(/^\/api\/tiles\/standard\/\d+\/\d+\/\d+\.png$/)
      }
    })

    it('draws the tiles it received under the route', async () => {
      stubTileNetwork()
      const { container } = renderPanel({ basemap: 'standard' })
      const base = layers(container)[BASE]

      await waitFor(() => expect(base.calls.some((c) => c.name === 'drawImage')).toBe(true))

      // Tiles first, route on top — a route painted under the basemap would be
      // invisible, which is the whole point of the ordering.
      const lastTile = base.calls.findLastIndex((c) => c.name === 'drawImage')
      const lastStroke = base.calls.findLastIndex((c) => c.name === 'stroke')
      expect(lastTile).toBeLessThan(lastStroke)
    })

    // Legally required by both OSM's and CARTO's terms. Not optional, not
    // collapsible, and rendered from the registry so a provider added later
    // cannot arrive without one.
    it('renders the attribution whenever tiles are shown', () => {
      stubTileNetwork()
      const { container } = renderPanel({ basemap: 'standard' })
      expect(container.querySelector('.map-panel__attribution').textContent).toMatch(/OpenStreetMap/)
    })

    it('offers every registry entry and reports a change', async () => {
      const user = userEvent.setup()
      const onBasemapChange = vi.fn()
      const { getByRole } = renderPanel({ onBasemapChange })

      expect(getByRole('radio', { name: 'None' })).toBeChecked()
      await user.click(getByRole('radio', { name: 'Map' }))
      expect(onBasemapChange).toHaveBeenCalledWith('standard')
    })

    // The disclosure belongs where the choice is made.
    it('carries the network disclosure beside the control', () => {
      const { container } = renderPanel()
      expect(container.querySelector('.basemap-control__notice').textContent).toMatch(
        /never sees your IP address/i,
      )
    })

    it('stops asking when the basemap is switched back off', async () => {
      const fetchSpy = stubTileNetwork()
      const { rerender, activity } = renderPanel({ basemap: 'standard' })
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())

      fetchSpy.mockClear()
      rerender(<MapPanel {...DEFAULTS} activity={activity} basemap="none" />)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('falls back to the private default for an unknown basemap id', () => {
      const fetchSpy = stubTileNetwork()
      const { container } = renderPanel({ basemap: 'satellite-pro' })

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(container.querySelector('.map-panel__attribution')).toBeNull()
    })
  })
})
