import { cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSharedActivityFromUrl } from './useSharedActivityFromUrl.js'

function Probe({ onLoad }) {
  useSharedActivityFromUrl(onLoad)
  return null
}

afterEach(() => {
  history.replaceState(null, '', '/')
})

describe('useSharedActivityFromUrl', () => {
  it('fires one load with the payload from the hash', () => {
    history.replaceState(null, '', '/#a=1AbCdEf')
    const onLoad = vi.fn()
    render(<Probe onLoad={onLoad} />)
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onLoad).toHaveBeenCalledWith({ type: 'shared', payload: '1AbCdEf' })
  })

  it('does nothing on an ordinary page load', () => {
    const onLoad = vi.fn()
    render(<Probe onLoad={onLoad} />)
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('ignores a hash that is not a share payload', () => {
    history.replaceState(null, '', '/#section')
    const onLoad = vi.fn()
    render(<Probe onLoad={onLoad} />)
    expect(onLoad).not.toHaveBeenCalled()
  })

  // main.jsx mounts the tree in StrictMode, which double-invokes effects in
  // development — the single-shot ref is what keeps that to one load.
  it('fires exactly once under StrictMode double-invoke', () => {
    history.replaceState(null, '', '/#a=1AbCdEf')
    const onLoad = vi.fn()
    render(
      <StrictMode>
        <Probe onLoad={onLoad} />
      </StrictMode>,
    )
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('does not re-fire when the callback identity changes', () => {
    history.replaceState(null, '', '/#a=1AbCdEf')
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Probe onLoad={first} />)
    rerender(<Probe onLoad={second} />)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('leaves the hash in place — the link stays bookmarkable', () => {
    history.replaceState(null, '', '/#a=1AbCdEf')
    render(<Probe onLoad={vi.fn()} />)
    cleanup()
    expect(location.hash).toBe('#a=1AbCdEf')
  })
})
