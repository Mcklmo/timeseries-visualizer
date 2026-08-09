import { describe, it, expect } from 'vitest'
import { createStreamCache } from './streamCache.js'

describe('createStreamCache', () => {
  it('returns what was stored, and undefined for a miss', () => {
    const cache = createStreamCache()
    cache.set('1', { time: { data: [0] } })

    expect(cache.get('1')).toEqual({ time: { data: [0] } })
    expect(cache.get('2')).toBeUndefined()
  })

  it('evicts the oldest entry once over capacity', () => {
    const cache = createStreamCache(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  // Least-recently-USED, not least-recently-written: reading an entry has to
  // move it to the back of the queue or the cache evicts what you are actually
  // cycling between.
  it('a read protects an entry from the next eviction', () => {
    const cache = createStreamCache(2)
    cache.set('a', 1)
    cache.set('b', 2)

    cache.get('a')
    cache.set('c', 3)

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
  })

  it('overwrites rather than duplicating an existing key', () => {
    const cache = createStreamCache(2)
    cache.set('a', 1)
    cache.set('a', 2)

    expect(cache.get('a')).toBe(2)
    expect(cache.size).toBe(1)
  })

  // Nothing derived from the athlete's data may outlive their grant, even in
  // memory — Disconnect calls this.
  it('clear empties it', () => {
    const cache = createStreamCache()
    cache.set('a', 1)

    cache.clear()

    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })
})
