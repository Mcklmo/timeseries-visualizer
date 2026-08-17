import { describe, it, expect, vi } from 'vitest'
import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Decoder, Encoder, Profile, Stream } from '@garmin/fitsdk'
import { AppProviders } from '../app/providers.jsx'
import { createDefaultSource } from '../data/sourceRegistry.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { ExportWindowButton, trimmedFilenameFor } from './ExportWindowButton.jsx'

const T0 = new Date('2026-01-01T06:00:00.000Z')
const RECORD_COUNT = 20

const at = (i) => new Date(T0.getTime() + i * 1000).toISOString()

// One synthetic file per format and the Activity they would all normalize to,
// kept deliberately in step: sample.t is seconds since startTime, which is
// exactly the mapping ExportWindowButton inverts to turn the zoom window back
// into wall clock. If the two ever drift, the trackpoint-count assertions below
// are what notice.
function fitBytes() {
  const encoder = new Encoder()
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    timeCreated: T0,
  })
  encoder.writeMesg({ mesgNum: Profile.MesgNum.SESSION, sport: 'running' })
  for (let i = 0; i < RECORD_COUNT; i++) {
    encoder.writeMesg({
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: new Date(T0.getTime() + i * 1000),
      distance: i * 3,
      enhancedSpeed: 3,
      heartRate: 140,
    })
  }
  return encoder.close()
}

const tcxText = () => `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running">
    <Id>${at(0)}</Id>
    <Lap StartTime="${at(0)}">
      <TotalTimeSeconds>19</TotalTimeSeconds>
      <DistanceMeters>57</DistanceMeters>
      <Calories>90</Calories>
      <Intensity>Active</Intensity>
      <TriggerMethod>Manual</TriggerMethod>
      <Track>
${Array.from(
  { length: RECORD_COUNT },
  (_, i) =>
    `        <Trackpoint><Time>${at(i)}</Time><DistanceMeters>${i * 3}</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>`,
).join('\n')}
      </Track>
    </Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`

const gpxText = () => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><type>running</type><trkseg>
${Array.from(
  { length: RECORD_COUNT },
  (_, i) => `    <trkpt lat="57.01${i}" lon="9.97"><ele>12</ele><time>${at(i)}</time></trkpt>`,
).join('\n')}
  </trkseg></trk>
</gpx>`

const fixtureActivity = {
  id: 'a1',
  sport: 'running',
  startTime: T0,
  totalTime: RECORD_COUNT - 1,
  totalMovingTime: RECORD_COUNT - 1,
  totalDistance: (RECORD_COUNT - 1) * 3,
  samples: Array.from({ length: RECORD_COUNT }, (_, i) => ({
    t: i,
    d: i * 3,
    speed: 3,
    heartRate: 140,
    moving: true,
  })),
  availableMetrics: ['pace', 'heartRate'],
  track: null,
}

const fileRef = (name, bytes) => ({ type: 'file', file: new File([bytes], name) })
const fitRef = () => fileRef('23870166877_ACTIVITY.fit', fitBytes())

async function gzip(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function Loader({ activityRef }) {
  const { load } = useActivity()
  useEffect(() => {
    load(activityRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// Zooming for real (an edge drag) needs a rendered chart; this writes the same
// state that drag would, which is all ExportWindowButton reads. It has to wait
// for the activity: ChartViewContext resets the window whenever the loaded
// activity changes, so a zoom set on mount would be thrown away by the load
// behind it.
function Zoom({ domain }) {
  const { activity } = useActivity()
  const { setZoom } = useChartView()
  useEffect(() => {
    if (activity && domain) setZoom(domain, domain)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity])
  return null
}

// A "nothing is rendered" assertion is only meaningful once the load has
// settled — otherwise it passes against the loading state and says nothing.
function Status() {
  const { status } = useActivity()
  return <div>status:{status}</div>
}

/**
 * ⚠️ `canExportWindow` and `readOriginalBytes` are taken from the REAL registry
 * rather than stubbed, so the gate and the byte-reading under test are the ones
 * that ship. Only `load` is hand-built — resolving a fixture activity keeps the
 * parsers out of a UI suite. They spread cleanly because the registry defines
 * both as closures on its object literal rather than as class methods.
 */
function renderButton({
  activityRef = fitRef(),
  domain = [5, 15],
  activity = fixtureActivity,
  registryOptions,
} = {}) {
  const registry = createDefaultSource(registryOptions)
  const source = {
    kind: 'mock',
    load: () => Promise.resolve(activity),
    canExportWindow: registry.canExportWindow,
    readOriginalBytes: vi.fn(registry.readOriginalBytes),
  }
  const view = render(
    <AppProviders source={source}>
      <Loader activityRef={activityRef} />
      <Zoom domain={domain} />
      <Status />
      <ExportWindowButton />
    </AppProviders>,
  )
  return { ...view, source }
}

const whenLoaded = () => waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument())

const exportButton = () => screen.queryByRole('button', { name: 'Export' })

// setupTests.js records every Blob handed to URL.createObjectURL.
const downloadedBytes = async () => {
  const entry = globalThis.__objectUrls[globalThis.__objectUrls.length - 1]
  return new Uint8Array(await entry.blob.arrayBuffer())
}

const downloadedText = async () => new TextDecoder().decode(await downloadedBytes())

function decodeRecords(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const { messages } = new Decoder(Stream.fromArrayBuffer(buffer)).read({
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
  })
  return messages.recordMesgs
}

/** Clicks Export and returns the filename the anchor was given. */
async function clickExport(user) {
  const clicks = []
  const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    clicks.push(this.download)
  })
  await waitFor(() => expect(exportButton()).toBeInTheDocument())
  await user.click(exportButton())
  return { clicks, spy }
}

describe('ExportWindowButton — the gate', () => {
  it('renders nothing while unzoomed — an unzoomed export is the file you already have', async () => {
    renderButton({ domain: null })
    await whenLoaded()
    expect(exportButton()).toBeNull()
  })

  it.each([
    ['a .fit file', () => fitRef()],
    ['a .tcx file', () => fileRef('run.tcx', tcxText())],
    ['a .gpx file', () => fileRef('run.gpx', gpxText())],
  ])('appears once %s is zoomed', async (_label, makeRef) => {
    renderButton({ activityRef: makeRef() })
    await whenLoaded()
    expect(exportButton()).toBeInTheDocument()
  })

  // A bulk export hands you a `.fit.gz`, and sourceRegistry's extension table
  // has no entry for it — so a gate routed through `sourceFor` would silently
  // take the button away from a file that has always had one.
  it('appears for a .fit.gz, which the extension table alone would miss', async () => {
    renderButton({ activityRef: fileRef('activity.fit.gz', await gzip(fitBytes())) })
    await whenLoaded()
    expect(exportButton()).toBeInTheDocument()
  })

  it('appears for an intervals.icu activity — the original upload is downloadable', async () => {
    renderButton({
      activityRef: { type: 'id', provider: 'intervals', id: 'i1' },
      registryOptions: { getIntervalsApiKey: () => 'k' },
    })
    await whenLoaded()
    expect(exportButton()).toBeInTheDocument()
  })

  // Strava has no original-file endpoint at all; the exclusion lives in its
  // adapter, and this asserts the UI honours it rather than re-deriving it.
  it('does NOT appear for a Strava activity', async () => {
    renderButton({ activityRef: { type: 'id', provider: 'strava', id: 's1' } })
    await whenLoaded()
    expect(exportButton()).toBeNull()
  })

  it('does not appear for a file whose name places it nowhere', async () => {
    renderButton({ activityRef: fileRef('run.kml', 'x') })
    await whenLoaded()
    expect(exportButton()).toBeNull()
  })
})

describe('ExportWindowButton — the download', () => {
  it('downloads a FIT holding exactly the windowed records, named after the original', async () => {
    const user = userEvent.setup()
    renderButton()

    const { clicks, spy } = await clickExport(user)

    await waitFor(() => expect(clicks).toEqual(['23870166877_ACTIVITY-trimmed.fit']))
    // t=5..15 inclusive at one record per second.
    const records = decodeRecords(await downloadedBytes())
    expect(records).toHaveLength(11)
    expect(records[0].timestamp).toEqual(new Date(T0.getTime() + 5000))
    expect(records[records.length - 1].timestamp).toEqual(new Date(T0.getTime() + 15000))
    // Re-based, the trap this whole feature turns on.
    expect(records[0].distance).toBe(0)

    spy.mockRestore()
  })

  it('downloads a TCX holding exactly the windowed trackpoints', async () => {
    const user = userEvent.setup()
    renderButton({ activityRef: fileRef('run.tcx', tcxText()) })

    const { clicks, spy } = await clickExport(user)

    await waitFor(() => expect(clicks).toEqual(['run-trimmed.tcx']))
    const text = await downloadedText()
    expect((text.match(/<Trackpoint>/g) ?? []).length).toBe(11)
    expect(text).toContain(`<DistanceMeters>0</DistanceMeters>`)

    spy.mockRestore()
  })

  it('downloads a GPX holding exactly the windowed track points', async () => {
    const user = userEvent.setup()
    renderButton({ activityRef: fileRef('run.gpx', gpxText()) })

    const { clicks, spy } = await clickExport(user)

    await waitFor(() => expect(clicks).toEqual(['run-trimmed.gpx']))
    expect(((await downloadedText()).match(/<trkpt\b/g) ?? []).length).toBe(11)

    spy.mockRestore()
  })

  it('names a .fit.gz download after its inflated stem, not its .gz one', async () => {
    const user = userEvent.setup()
    renderButton({ activityRef: fileRef('activity.fit.gz', await gzip(fitBytes())) })

    const { clicks, spy } = await clickExport(user)

    await waitFor(() => expect(clicks).toEqual(['activity-trimmed.fit']))
    spy.mockRestore()
  })

  // The app's only network call that isn't a `load` — and it must happen on
  // CLICK, not on load.
  it('re-downloads an intervals.icu original on click and trims that', async () => {
    const fetchImpl = vi.fn(async () => new Response(new TextEncoder().encode(tcxText())))
    const user = userEvent.setup()
    const { source } = renderButton({
      activityRef: { type: 'id', provider: 'intervals', id: 'i1', name: 'Tempo 5×1k' },
      registryOptions: { getIntervalsApiKey: () => 'k', fetchImpl },
    })

    await whenLoaded()
    // Nothing fetched yet: `load` was the hand-built double, so any request at
    // all can only have come from the export path.
    expect(source.readOriginalBytes).not.toHaveBeenCalled()

    const { clicks, spy } = await clickExport(user)

    await waitFor(() => expect(clicks).toEqual(['tempo-5-1k-trimmed.tcx']))
    expect(source.readOriginalBytes).toHaveBeenCalledTimes(1)
    expect(((await downloadedText()).match(/<Trackpoint>/g) ?? []).length).toBe(11)

    spy.mockRestore()
  })
})

describe('ExportWindowButton — failures stay beside the button', () => {
  it('surfaces a trim failure instead of throwing away the chart', async () => {
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    // Not a FIT file at all, despite the name — the byte-level failure the
    // synchronous filename gate cannot see coming.
    renderButton({ activityRef: fileRef('bogus.fit', 'not fit') })

    await waitFor(() => expect(exportButton()).toBeInTheDocument())
    await user.click(exportButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a FIT, TCX or GPX recording/i)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('renders an adapter rejection verbatim — a key cleared in another tab', async () => {
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    let apiKey = 'k'
    renderButton({
      activityRef: { type: 'id', provider: 'intervals', id: 'i1' },
      registryOptions: { getIntervalsApiKey: () => apiKey },
    })

    await waitFor(() => expect(exportButton()).toBeInTheDocument())
    apiKey = null
    await user.click(exportButton())

    // IntervalsApiError propagates through the port untouched, so its own
    // user-facing copy is what lands here.
    expect(await screen.findByRole('alert')).toHaveTextContent(/Not connected to intervals\.icu/i)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('trimmedFilenameFor', () => {
  it('keeps a dropped file\'s own stem', () => {
    expect(trimmedFilenameFor(fileRef('23870166877_ACTIVITY.fit', 'x'), 'fit')).toBe(
      '23870166877_ACTIVITY-trimmed.fit',
    )
    expect(trimmedFilenameFor(fileRef('run.TCX', 'x'), 'tcx')).toBe('run-trimmed.tcx')
    expect(trimmedFilenameFor(fileRef('run.fit.gz', 'x'), 'fit')).toBe('run-trimmed.fit')
  })

  it('slugs a provider activity title — there is no server filename to read', () => {
    const ref = { type: 'id', provider: 'intervals', id: 'i1', name: 'Tempo 5×1k — easy' }
    expect(trimmedFilenameFor(ref, 'fit')).toBe('tempo-5-1k-easy-trimmed.fit')
  })

  it('falls back to provider and id, because a stub picker row carries no name', () => {
    const ref = { type: 'id', provider: 'intervals', id: 'i1' }
    expect(trimmedFilenameFor(ref, 'tcx')).toBe('intervals-i1-trimmed.tcx')
    // A title that slugs to nothing at all takes the same path.
    expect(trimmedFilenameFor({ ...ref, name: '— —' }, 'tcx')).toBe('intervals-i1-trimmed.tcx')
  })
})
