import { describe, it, expect, vi } from 'vitest'
import { createDefaultSource } from './sourceRegistry.js'

/** A ref for a file with the given name; the bytes never matter here, because
 *  every assertion is about *which* adapter a ref routes to, not what it
 *  eventually parses. */
const fileRef = (name) => ({ type: 'file', file: new File(['x'], name) })

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

  // Deliberate, and long-standing: TcxActivitySource then rejects it with a
  // real parser error, which is a better answer than a shrug from the registry.
  it('falls through to TCX for an unrecognised extension', () => {
    const registry = createDefaultSource()
    expect(registry.sourceFor(fileRef('run.kml')).kind).toBe('tcx')
    expect(registry.sourceFor(fileRef('run')).kind).toBe('tcx')
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
