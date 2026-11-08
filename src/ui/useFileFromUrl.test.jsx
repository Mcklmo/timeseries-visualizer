import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFileFromUrl } from './useFileFromUrl.js'

function Probe({ onLoad, onFail = vi.fn() }) {
  useFileFromUrl(onLoad, onFail)
  return null
}

afterEach(() => {
  history.replaceState(null, '', '/')
})

describe('useFileFromUrl', () => {
  it('loads the bytes as an extensionless file, after clearing the hash', async () => {
    // base64url of "<gpx/>"
    history.replaceState(null, '', '/?x=1#f=PGdweC8-')
    let hashAtLoad
    const onLoad = vi.fn(() => {
      hashAtLoad = location.hash
    })
    render(<Probe onLoad={onLoad} />)

    expect(onLoad).toHaveBeenCalledTimes(1)
    const [{ type, file }] = onLoad.mock.calls[0]
    expect(type).toBe('file')
    expect(file.name).toBe('activity')
    expect(await file.text()).toBe('<gpx/>')
    expect(hashAtLoad).toBe('')
    expect(location.pathname + location.search).toBe('/?x=1')
  })

  it('fails with the unreadable-link message on bad base64url', () => {
    history.replaceState(null, '', '/#f=not+base64')
    const onLoad = vi.fn()
    const onFail = vi.fn()
    render(<Probe onLoad={onLoad} onFail={onFail} />)

    expect(onLoad).not.toHaveBeenCalled()
    expect(onFail).toHaveBeenCalledWith(new Error("This link's activity couldn't be read."))
    expect(location.hash).toBe('')
  })

  it('does nothing without an #f= hash', () => {
    history.replaceState(null, '', '/#a=1AbCdEf')
    const onLoad = vi.fn()
    const onFail = vi.fn()
    render(<Probe onLoad={onLoad} onFail={onFail} />)

    expect(onLoad).not.toHaveBeenCalled()
    expect(onFail).not.toHaveBeenCalled()
    expect(location.hash).toBe('#a=1AbCdEf')
  })

  // main.jsx mounts the tree in StrictMode, which double-invokes effects.
  it('fires exactly once under StrictMode double-invoke', () => {
    history.replaceState(null, '', '/#f=PGdweC8-')
    const onLoad = vi.fn()
    render(
      <StrictMode>
        <Probe onLoad={onLoad} />
      </StrictMode>,
    )
    expect(onLoad).toHaveBeenCalledTimes(1)
  })
})
