import { describe, expect, it } from 'vitest'
import { previewPoints } from './sharePreview.js'

describe('previewPoints', () => {
  it('averages samples per time bucket and breaks the line at a missing reading', () => {
    const samples = [
      { t: 0, v: 1, moving: false },
      { t: 1, v: 3 },
      { t: 5, v: null },
      { t: 10, v: 5 },
    ]
    expect(previewPoints(samples, (s) => s.v, 2)).toEqual([[0.25, 2], null, [0.75, 5]])
  })
})
