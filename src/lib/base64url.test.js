import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './base64url.js'

describe('toBase64Url / fromBase64Url', () => {
  it('round-trips bytes of every value', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) bytes[i] = i
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
  })

  it('round-trips the awkward lengths around the 3-byte grouping', () => {
    for (const length of [0, 1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(length).fill(0xff)
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    }
  })

  it('emits only the URL-safe alphabet, unpadded', () => {
    // 0xfb 0xef 0xbe is the classic byte run whose plain base64 is "++++" —
    // if the alphabet swap regressed, this is the input that shows it.
    const encoded = toBase64Url(new Uint8Array([0xfb, 0xef, 0xbe, 0xff, 0xff]))
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('survives payloads past the fromCharCode chunk boundary', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 7)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) & 0xff
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
  })

  it('rejects characters atob would quietly accept', () => {
    expect(() => fromBase64Url('ab+d')).toThrow()
    expect(() => fromBase64Url('ab/d')).toThrow()
    expect(() => fromBase64Url('abc=')).toThrow()
    expect(() => fromBase64Url('ab d')).toThrow()
    expect(() => fromBase64Url('ab\ncd')).toThrow()
  })

  it('rejects the impossible length class', () => {
    expect(() => fromBase64Url('abcde')).toThrow()
  })

  it('rejects non-strings', () => {
    expect(() => fromBase64Url(null)).toThrow()
    expect(() => fromBase64Url(42)).toThrow()
  })
})
