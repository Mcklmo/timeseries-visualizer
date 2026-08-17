import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createDefaultSource } from './sourceRegistry.js'

/** A ref for a file with the given name; the bytes only matter in the sniffing
 *  block below, because every other assertion is about *which* adapter a ref
 *  routes to, not what it eventually parses. */
const fileRef = (name, bytes = 'x') => ({ type: 'file', file: new File([bytes], name) })

async function gzip(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe('sourceFor — file refs dispatch on the extension', () => {
  it.each([
    ['run.fit', 'fit'],
    ['run.gpx', 'gpx'],
    ['run.tcx', 'tcx'],
  ])('routes %s to the %s parser', (name, kind) => {
    expect(createDefaultSource().sourceFor(fileRef(name)).kind).toBe(kind)
  })

  it('is case-insensitive about the extension', () => {
    expect(createDefaultSource().sourceFor(fileRef('RUN.FIT')).kind).toBe('fit')
  })

  // Naming a file is only half the dispatch now: an unrecognised extension has
  // no answer until the bytes have been read, so `sourceFor` says so rather
  // than guessing TCX and being overruled a moment later.
  it('returns null for an unrecognised extension, deferring to the byte sniff', () => {
    const registry = createDefaultSource()
    expect(registry.sourceFor(fileRef('run.kml'))).toBeNull()
    expect(registry.sourceFor(fileRef('run'))).toBeNull()
  })
})

// The defect this closes: the *file* path trusted the filename while the
// *network* path sniffed bytes, so a `.fit.gz` — which is what a bulk export
// hands you — fell through to the TCX parser and died on "invalid XML", with
// the inflate code sitting one directory away.
describe('load — an unrecognised extension falls back to sniffing the bytes', () => {
  const fitFixture = () => readFile('fixtures/23870166877_ACTIVITY.fit')

  it('parses a gzipped FIT dropped as .fit.gz', async () => {
    const bytes = await gzip(await fitFixture())
    const activity = await createDefaultSource().load(fileRef('activity.fit.gz', bytes))

    expect(activity.sport).toBe('running')
    expect(activity.samples.length).toBeGreaterThan(0)
  })

  it('parses an uncompressed FIT whose name says nothing at all', async () => {
    const activity = await createDefaultSource().load(fileRef('activity', await fitFixture()))
    expect(activity.sport).toBe('running')
  })

  it('parses a TCX that arrived as .xml', async () => {
    const xml = await readFile('fixtures/activity_23870166877.tcx', 'utf8')
    const activity = await createDefaultSource().load(fileRef('export.xml', xml))
    expect(activity.samples.length).toBeGreaterThan(0)
  })

  // A recognised extension is trusted and never read twice — the common path
  // must not pay for the fallback.
  it('never sniffs a file whose extension is recognised', async () => {
    const file = new File([await fitFixture()], 'run.fit')
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer')

    await createDefaultSource().load({ type: 'file', file })

    // Exactly one read, and it is the parser's own.
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
  })

  // Still deliberate, and still load-bearing: bytes that match nothing get a
  // real parser error rather than a shrug from the registry.
  it('falls through to TCX when the bytes match nothing either', async () => {
    await expect(createDefaultSource().load(fileRef('run.kml', 'not an activity'))).rejects.toThrow()
  })

  it('falls through rather than crashing on a truncated gzip stream', async () => {
    const truncated = (await gzip(await fitFixture())).subarray(0, 12)
    await expect(createDefaultSource().load(fileRef('run.gz', truncated))).rejects.toThrow()
  })
})

describe('sourceFor — id refs dispatch on the provider, never on the id', () => {
  it('routes an intervals.icu ref to the intervals adapter', () => {
    const source = createDefaultSource().sourceFor({ type: 'id', provider: 'intervals', id: 'i1' })
    expect(source.kind).toBe('intervals')
  })

  // The whole reason `provider` is required. Falling back to one provider
  // would mean issuing one athlete's credential against another service, or
  // reading from an account the user never picked — so this throws instead.
  it('throws on an id ref with no provider, rather than guessing', () => {
    const registry = createDefaultSource()
    expect(() => registry.sourceFor({ type: 'id', id: 'i1' })).toThrow(/provider/i)
  })

  it('throws on an unknown provider', () => {
    const registry = createDefaultSource()
    expect(() => registry.sourceFor({ type: 'id', provider: 'garmin', id: 'g1' })).toThrow(/garmin/)
  })

  it('surfaces the throw through load(), not just sourceFor()', async () => {
    await expect(createDefaultSource().load({ type: 'id', id: 'i1' })).rejects.toThrow(/provider/i)
  })
})

describe('canExportWindow — is there a recorded original file behind this ref?', () => {
  const canExport = (ref) => createDefaultSource().canExportWindow(ref)

  it.each(['run.fit', 'run.tcx', 'run.gpx', 'RUN.FIT'])('says yes to %s', (name) => {
    expect(canExport(fileRef(name))).toBe(true)
  })

  // ⚠️ The regression this exists for. `sourceFor` returns NULL for a
  // `.fit.gz` — SOURCE_BY_EXTENSION has no entry for it, and `load` rescues it
  // by sniffing — so routing the gate through `sourceFor` would silently take
  // the Export button away from a file that has always had one.
  it.each(['activity.fit.gz', 'run.tcx.gz', 'run.gpx.gz'])('still says yes to %s', (name) => {
    expect(canExport(fileRef(name))).toBe(true)
  })

  it('says no to a name it cannot place, and to no ref at all', () => {
    expect(canExport(fileRef('run.kml'))).toBe(false)
    expect(canExport(fileRef('run'))).toBe(false)
    expect(canExport(undefined)).toBe(false)
  })

  it('delegates an id ref to its provider — yes for intervals.icu, no for Strava', () => {
    // intervals.icu hands back the athlete's original upload; Strava has no
    // original-file endpoint at all and declines in its own adapter.
    expect(canExport({ type: 'id', provider: 'intervals', id: 'i1' })).toBe(true)
    expect(canExport({ type: 'id', provider: 'strava', id: 's1' })).toBe(false)
  })

  // Synchronous, unlike everything else on the port: it is asked during render.
  // An unknown provider must NOT throw here the way `sourceFor` does — a throw
  // during render loses the chart the athlete is looking at.
  it('says no to an unknown provider instead of throwing', () => {
    expect(canExport({ type: 'id', provider: 'garmin', id: 'g1' })).toBe(false)
    expect(canExport({ type: 'id', id: 'i1' })).toBe(false)
  })
})

describe('readOriginalBytes — the original file, inflated', () => {
  it('reads a dropped file straight through', async () => {
    const bytes = await createDefaultSource().readOriginalBytes(fileRef('run.fit', 'hello'))
    expect(new TextDecoder().decode(bytes)).toBe('hello')
  })

  it('inflates a .fit.gz, so the caller never learns it was compressed', async () => {
    const original = await readFile('fixtures/23870166877_ACTIVITY.fit')
    const bytes = await createDefaultSource().readOriginalBytes(fileRef('run.fit.gz', await gzip(original)))

    expect(bytes.length).toBe(original.length)
  })

  it('delegates an id ref to its provider', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    const registry = createDefaultSource({ getIntervalsApiKey: () => 'k', fetchImpl })

    const bytes = await registry.readOriginalBytes({ type: 'id', provider: 'intervals', id: 'i1' })

    expect(Array.from(bytes)).toEqual([1, 2, 3])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects for a provider that has no original file', async () => {
    await expect(
      createDefaultSource().readOriginalBytes({ type: 'id', provider: 'strava', id: 's1' }),
    ).rejects.toThrow(/original file/i)
  })

  it('rejects loudly on an unknown provider rather than guessing', async () => {
    await expect(
      createDefaultSource().readOriginalBytes({ type: 'id', provider: 'garmin', id: 'g1' }),
    ).rejects.toThrow(/garmin/)
  })
})

// The property App.jsx used to hold and a registry could easily lose: the
// credential is read through a thunk on every load, never captured while the
// registry is constructed. Without it, a Disconnect would keep working until
// the tab was reloaded.
describe('credentials are read at load time, not at construction', () => {
  it('never calls the credential thunk while constructing', () => {
    const getIntervalsApiKey = vi.fn(() => 'k')
    createDefaultSource({ getIntervalsApiKey })
    expect(getIntervalsApiKey).not.toHaveBeenCalled()
  })

  it('sees a key cleared after construction', async () => {
    let key = 'still-valid'
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    const registry = createDefaultSource({ getIntervalsApiKey: () => key, fetchImpl })
    const ref = { type: 'id', provider: 'intervals', id: 'i1' }

    // First load reaches the network with the key that exists right now.
    await registry.load(ref).catch(() => {})
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    key = null
    // Second load must refuse locally — no second request — because the
    // adapter re-read the thunk rather than the value it saw the first time.
    await expect(registry.load(ref)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
