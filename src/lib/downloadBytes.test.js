import { describe, it, expect, vi } from 'vitest'
import { downloadBytes } from './downloadBytes.js'

// jsdom has no URL.createObjectURL; setupTests.js installs a recording stub and
// publishes what it was handed as globalThis.__objectUrls.
const lastObjectUrl = () => globalThis.__objectUrls[globalThis.__objectUrls.length - 1]

describe('downloadBytes', () => {
  it('hands the bytes to the browser as a blob and clicks a download link for them', async () => {
    const clicks = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicks.push({ href: this.href, download: this.download })
    })

    downloadBytes(new Uint8Array([1, 2, 3, 4]), 'run-trimmed.fit')

    const entry = lastObjectUrl()
    expect(await entry.blob.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3, 4]).buffer)
    expect(entry.blob.type).toBe('application/octet-stream')
    expect(clicks).toEqual([{ href: entry.url, download: 'run-trimmed.fit' }])

    spy.mockRestore()
  })

  it('revokes the object URL, so a downloaded file is not pinned in memory for the session', () => {
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadBytes(new Uint8Array([9]), 'x.fit')

    expect(lastObjectUrl().revoked).toBe(true)
    spy.mockRestore()
  })

  it('never inserts the anchor into the document', () => {
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadBytes(new Uint8Array([9]), 'x.fit')

    expect(document.querySelectorAll('a')).toHaveLength(0)
    spy.mockRestore()
  })
})
