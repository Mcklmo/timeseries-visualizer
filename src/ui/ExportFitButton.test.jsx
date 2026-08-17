import { describe, it, expect, vi } from 'vitest'
import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Decoder, Encoder, Profile, Stream } from '@garmin/fitsdk'
import { AppProviders } from '../app/providers.jsx'
import { useActivity } from '../state/ActivityContext.jsx'
import { useChartView } from '../state/ChartViewContext.jsx'
import { ExportFitButton } from './ExportFitButton.jsx'

const T0 = new Date('2026-01-01T06:00:00.000Z')
const RECORD_COUNT = 20

// One synthetic FIT and the Activity it would normalize to, kept deliberately
// in step: sample.t is seconds since startTime, which is exactly the mapping
// ExportFitButton inverts to turn the zoom window back into wall clock. If the
// two ever drift, the record-count assertion below is what notices.
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

const fitRef = () => ({
  type: 'file',
  file: new File([fitBytes()], '23870166877_ACTIVITY.fit', { type: 'application/vnd.ant.fit' }),
})

function Loader({ activityRef }) {
  const { load } = useActivity()
  useEffect(() => {
    load(activityRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// Zooming for real (an edge drag) needs a rendered chart; this writes the same
// state that drag would, which is all ExportFitButton reads. It has to wait for
// the activity: ChartViewContext resets the window whenever the loaded activity
// changes, so a zoom set on mount would be thrown away by the load behind it.
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

function renderButton({ activityRef = fitRef(), domain = [5, 15], activity = fixtureActivity } = {}) {
  const source = { kind: 'mock', load: () => Promise.resolve(activity) }
  return render(
    <AppProviders source={source}>
      <Loader activityRef={activityRef} />
      <Zoom domain={domain} />
      <Status />
      <ExportFitButton />
    </AppProviders>,
  )
}

const whenLoaded = () => waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument())

const exportButton = () => screen.queryByRole('button', { name: 'Export' })

// setupTests.js records every Blob handed to URL.createObjectURL.
const downloadedBytes = async () => {
  const entry = globalThis.__objectUrls[globalThis.__objectUrls.length - 1]
  return new Uint8Array(await entry.blob.arrayBuffer())
}

function decodeRecords(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const { messages } = new Decoder(Stream.fromArrayBuffer(buffer)).read({
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
  })
  return messages.recordMesgs
}

describe('ExportFitButton', () => {
  it('renders nothing while unzoomed — an unzoomed export is the file you already have', async () => {
    renderButton({ domain: null })
    await whenLoaded()
    expect(exportButton()).toBeNull()
  })

  it('renders nothing for a synced activity — an id ref holds no bytes to trim', async () => {
    renderButton({ activityRef: { type: 'id', provider: 'strava', id: '123' } })
    await whenLoaded()
    expect(exportButton()).toBeNull()
  })

  it('renders nothing for a .gpx file — only FIT is exportable', async () => {
    renderButton({ activityRef: { type: 'file', file: new File(['<gpx/>'], 'run.gpx') } })
    await whenLoaded()
    expect(exportButton()).toBeNull()
  })

  it('appears once a .fit file is zoomed', async () => {
    renderButton()
    await whenLoaded()
    expect(exportButton()).toBeInTheDocument()
  })

  it('downloads a FIT holding exactly the windowed records, named after the original', async () => {
    const clicks = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicks.push(this.download)
    })
    const user = userEvent.setup()
    renderButton()

    await waitFor(() => expect(exportButton()).toBeInTheDocument())
    await user.click(exportButton())

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

  it('surfaces a trim failure beside the button instead of throwing away the chart', async () => {
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    // Not a FIT file at all, despite the name — the byte-level failure the
    // synchronous filename gate cannot see coming.
    renderButton({ activityRef: { type: 'file', file: new File(['not fit'], 'bogus.fit') } })

    await waitFor(() => expect(exportButton()).toBeInTheDocument())
    await user.click(exportButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid FIT file/i)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
