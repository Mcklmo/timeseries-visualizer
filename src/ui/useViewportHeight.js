// The viewport height the slot layout solves against (slotLayout.js). Sibling
// of useIsScrolled.js / useIsNarrow.js next door.
//
// window.innerHeight rather than a measured element: the panels snap flush to
// the viewport top (the sticky header fades to transparent once scrolled), so
// the viewport IS the box being filled. On iOS the URL bar counts too:
// innerHeight tracks the visual viewport and fires `resize` when the bar
// settles, so the layout re-solves then; the transient mismatch while the bar
// is animating is accepted.
import { useEffect, useState } from 'react'
import { useDebouncedValue } from './useDebouncedValue.js'

// Long enough to swallow the resize storm of a live window drag — every raw
// event would re-render every Recharts panel — short enough that the layout
// settles before the user's hand has left the mouse.
const RESIZE_DEBOUNCE_MS = 150

export function useViewportHeight() {
  const [height, setHeight] = useState(() => window.innerHeight)

  useEffect(() => {
    const handleResize = () => setHeight(window.innerHeight)
    // Re-read on mount as well as on change, for the same reason useIsNarrow
    // does: the window can have resized between the initial useState and this
    // effect running.
    handleResize()
    window.addEventListener('resize', handleResize, { passive: true })
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Debounced HERE, not in the caller: the initial value passes through
  // useDebouncedValue's useState synchronously, so first render is correct
  // with no timers — only subsequent changes wait out the storm.
  return useDebouncedValue(height, RESIZE_DEBOUNCE_MS)
}
