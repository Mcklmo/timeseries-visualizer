// True below the one breakpoint this app has (720px, the sole media query in
// global.css). Mirrors useIsScrolled in App.jsx.
//
// This exists because two narrow-screen adaptations cannot be expressed in
// CSS: ChartStack's panel heights are JS constants fed to <ResponsiveContainer
// height>, and ControlPanel's collapse drives a <details open> prop rather
// than a display rule (see ARCHITECTURE.md §13 Route A). Everything else that
// changes below 720px stays in the media query where it belongs.
import { useEffect, useState } from 'react'

const NARROW_QUERY = '(max-width: 720px)'

export function useIsNarrow(query = NARROW_QUERY) {
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handleChange = (e) => setIsNarrow(e.matches)
    // Re-read on mount as well as on change: the query can already have
    // flipped between the initial useState and this effect (e.g. an orientation
    // change during hydration).
    setIsNarrow(mql.matches)
    // addListener is the pre-Safari-14 spelling. Still worth keeping — iOS
    // Safari is the primary target of this whole workstream.
    if (mql.addEventListener) {
      mql.addEventListener('change', handleChange)
      return () => mql.removeEventListener('change', handleChange)
    }
    mql.addListener(handleChange)
    return () => mql.removeListener(handleChange)
  }, [query])

  return isNarrow
}
