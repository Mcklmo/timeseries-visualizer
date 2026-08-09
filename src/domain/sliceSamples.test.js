import { describe, it, expect } from 'vitest'
import { indexAtX, sliceBoundsByX, sliceSamplesByX } from './sliceSamples.js'

describe('indexAtX', () => {
  const samples = [
    { t: 0, d: 0 },
    { t: 10, d: 50 },
    { t: 20, d: 100 },
  ]

  it('finds an exact hit', () => {
    expect(indexAtX(samples, 't', 10)).toBe(1)
  })

  it('rounds up to the next sample between two of them', () => {
    expect(indexAtX(samples, 't', 11)).toBe(2)
  })

  it('reads whichever axis it is given', () => {
    expect(indexAtX(samples, 'd', 50)).toBe(1)
  })

  // Clamped rather than returning `length`: the caller subscripts the result
  // directly to find a position on the route, and an off-the-end index there
  // would read undefined and draw the marker at NaN.
  it('clamps to the last real index past the end', () => {
    expect(indexAtX(samples, 't', 999)).toBe(2)
  })

  it('is total for an empty array or a garbage value', () => {
    expect(indexAtX([], 't', 5)).toBe(0)
    expect(indexAtX(samples, 't', NaN)).toBe(0)
    expect(indexAtX(null, 't', 5)).toBe(0)
  })
})

const samples = [
  { t: 0, d: 0 },
  { t: 10, d: 50 },
  { t: 20, d: 100 },
  { t: 30, d: 150 },
  { t: 40, d: 200 },
]

const ts = (result) => result.map((s) => s.t)

describe('sliceSamplesByX', () => {
  it('returns the samples inside the window, both bounds inclusive', () => {
    // 10 and 30 sit exactly on the edges: they are visibly on screen, and
    // dropping either would shorten the window's measured span by an interval.
    expect(ts(sliceSamplesByX(samples, 't', [10, 30]))).toEqual([10, 20, 30])
  })

  it('excludes samples just outside either edge', () => {
    expect(ts(sliceSamplesByX(samples, 't', [10.001, 29.999]))).toEqual([20])
  })

  it('slices on distance when asked for distance', () => {
    expect(ts(sliceSamplesByX(samples, 'd', [50, 150]))).toEqual([10, 20, 30])
  })

  it('returns the whole array for a window covering the full extent', () => {
    expect(ts(sliceSamplesByX(samples, 't', [0, 40]))).toEqual([0, 10, 20, 30, 40])
  })

  it('clips a window that hangs off the start or the end', () => {
    expect(ts(sliceSamplesByX(samples, 't', [-100, 15]))).toEqual([0, 10])
    expect(ts(sliceSamplesByX(samples, 't', [35, 900]))).toEqual([40])
  })

  // Distance is monotonic but NOT strictly increasing: standing still logs the
  // same d for every sample of the pause. lowerBound must land on the first of
  // a run and upperBound past the last, or a window ending at a pause silently
  // loses (or gains) the whole stationary stretch.
  it('handles repeated x values at both bounds', () => {
    const stationary = [
      { t: 0, d: 0 },
      { t: 10, d: 100 },
      { t: 20, d: 100 },
      { t: 30, d: 100 },
      { t: 40, d: 200 },
    ]
    expect(ts(sliceSamplesByX(stationary, 'd', [100, 100]))).toEqual([10, 20, 30])
    expect(ts(sliceSamplesByX(stationary, 'd', [0, 100]))).toEqual([0, 10, 20, 30])
    expect(ts(sliceSamplesByX(stationary, 'd', [100, 200]))).toEqual([10, 20, 30, 40])
  })

  // The MAX_ZOOM=50 cap still allows a window narrower than one breadcrumb
  // interval on a sparse log. The line is drawn across it as the segment
  // joining the two bracketing samples, so the stats must be too.
  it('widens an empty window to the two samples the line is drawn across', () => {
    expect(ts(sliceSamplesByX(samples, 't', [22, 24]))).toEqual([20, 30])
  })

  it('returns nothing for a window entirely off either end of the recording', () => {
    // No bracketing pair exists there, and nothing is drawn there either.
    expect(sliceSamplesByX(samples, 't', [-50, -10])).toEqual([])
    expect(sliceSamplesByX(samples, 't', [60, 90])).toEqual([])
  })

  it('handles an empty or absent sample array', () => {
    expect(sliceSamplesByX([], 't', [0, 40])).toEqual([])
    expect(sliceSamplesByX(null, 't', [0, 40])).toEqual([])
    expect(sliceSamplesByX(undefined, 't', [0, 40])).toEqual([])
  })

  it('falls back to every sample rather than throwing on a garbage domain', () => {
    expect(ts(sliceSamplesByX(samples, 't', ['dataMin', 'dataMax']))).toEqual([0, 10, 20, 30, 40])
    expect(ts(sliceSamplesByX(samples, 't', null))).toEqual([0, 10, 20, 30, 40])
    expect(ts(sliceSamplesByX(samples, 't', [NaN, 30]))).toEqual([0, 10, 20, 30, 40])
  })

  it('accepts a reversed domain rather than reporting an empty window', () => {
    expect(ts(sliceSamplesByX(samples, 't', [30, 10]))).toEqual([10, 20, 30])
  })

  it('does not alias the input array', () => {
    const out = sliceSamplesByX(samples, 't', [0, 40])
    expect(out).not.toBe(samples)
    expect(out).toEqual(samples)
  })

  // The one exception, and it is load-bearing rather than incidental:
  // statsBasisFor's unzoomed path is what keeps the default render
  // byte-identical, and it rests on the activity's own array coming back.
  it('hands back the input array itself for a garbage domain', () => {
    expect(sliceSamplesByX(samples, 't', ['dataMin', 'dataMax'])).toBe(samples)
  })
})

// The same cases as above, one level down: sliceSamplesByX is built on these
// bounds, and elapsedTimeFor and displayIndices read them without the copy.
describe('sliceBoundsByX', () => {
  it('reports the half-open range of the window, both edges inclusive', () => {
    expect(sliceBoundsByX(samples, 't', [10, 30])).toEqual([1, 4])
  })

  it('excludes samples just outside either edge', () => {
    expect(sliceBoundsByX(samples, 't', [10.001, 29.999])).toEqual([2, 3])
  })

  it('bounds on distance when asked for distance', () => {
    expect(sliceBoundsByX(samples, 'd', [50, 150])).toEqual([1, 4])
  })

  it('reports the whole array for a window covering the full extent', () => {
    expect(sliceBoundsByX(samples, 't', [0, 40])).toEqual([0, 5])
  })

  it('clips a window that hangs off the start or the end', () => {
    expect(sliceBoundsByX(samples, 't', [-100, 15])).toEqual([0, 2])
    expect(sliceBoundsByX(samples, 't', [35, 900])).toEqual([4, 5])
  })

  // The bracketing pair: a window narrower than one breadcrumb interval still
  // has a line drawn across it, so it still has bounds.
  it('widens an empty window to the pair the line is drawn across', () => {
    expect(sliceBoundsByX(samples, 't', [22, 24])).toEqual([2, 4])
  })

  it('reports an empty range for a window off either end of the recording', () => {
    expect(sliceBoundsByX(samples, 't', [-50, -10])).toEqual([0, 0])
    expect(sliceBoundsByX(samples, 't', [60, 90])).toEqual([0, 0])
  })

  it('reports an empty range for an empty or absent sample array', () => {
    expect(sliceBoundsByX([], 't', [0, 40])).toEqual([0, 0])
    expect(sliceBoundsByX(null, 't', [0, 40])).toEqual([0, 0])
  })

  // NOT [0, 0]: a domain nobody can read is "everything", the same answer
  // sliceSamplesByX gives, or an unzoomed chart would draw nothing at all.
  it('falls back to the whole range rather than throwing on a garbage domain', () => {
    expect(sliceBoundsByX(samples, 't', ['dataMin', 'dataMax'])).toEqual([0, 5])
    expect(sliceBoundsByX(samples, 't', null)).toEqual([0, 5])
    expect(sliceBoundsByX(samples, 't', [NaN, 30])).toEqual([0, 5])
  })

  it('accepts a reversed domain', () => {
    expect(sliceBoundsByX(samples, 't', [30, 10])).toEqual([1, 4])
  })

  // Identity with the slice it backs, over every case above: two
  // implementations of "what is in the window" is exactly the drift this
  // extraction exists to prevent.
  it('agrees with sliceSamplesByX on every window', () => {
    const domains = [[10, 30], [10.001, 29.999], [0, 40], [-100, 15], [35, 900], [22, 24], [60, 90], [30, 10]]
    for (const domain of domains) {
      const [start, end] = sliceBoundsByX(samples, 't', domain)
      expect(sliceSamplesByX(samples, 't', domain)).toEqual(samples.slice(start, end))
    }
  })
})
