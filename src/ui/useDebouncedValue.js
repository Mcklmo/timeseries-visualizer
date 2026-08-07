// Its own file rather than inline in IntervalsPage (cf. useIsScrolled in
// App.jsx, which stayed inline) purely so the timer behaviour can be tested
// with fake timers alone, without rendering a page that also fetches.
import { useEffect, useState } from 'react'

/**
 * `value`, but only after it has stopped changing for `delayMs`. Each change
 * restarts the wait — a mid-flight keystroke cancels the pending update rather
 * than queueing a second one, which is what keeps typing to one request per
 * burst instead of one per character.
 *
 * @template T
 * @param {T} value
 * @param {number} [delayMs]
 * @returns {T}
 */
export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
