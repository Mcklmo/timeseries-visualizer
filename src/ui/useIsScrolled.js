// True once the page has actually scrolled away from the top. Sibling of
// useIsNarrow.js, which named it as the thing it mirrored while it was still
// inlined in App.jsx.
//
// Drives .app-header--faded (see global.css): once scrolled, the header's
// background/border, the load-activity-bar and the quiet text controls
// collapse away entirely, giving that space back to the charts — only
// .app-header__title stays put. That cluster is the lockup *and* the
// activity's identity (name, sport, when, how long), so a mid-scroll
// screenshot says both which app and which workout it is. Hovering or
// focusing the header brings everything back without needing to scroll to the
// top first.
import { useEffect, useState } from 'react'

// Below this, the header stays fully opaque — only fades once the user has
// actually scrolled away from the top, not on a stray 1px wheel tick.
export const HEADER_FADE_SCROLL_THRESHOLD = 8

export function useIsScrolled(threshold = HEADER_FADE_SCROLL_THRESHOLD) {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > threshold)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [threshold])

  return isScrolled
}
