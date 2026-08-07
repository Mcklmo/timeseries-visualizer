import { describe, it, expect } from 'vitest'
import { sliceSamplesByX } from './sliceSamples.js'

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
})
