// Footer entry point for the feedback flow: the trigger plus the open/closed
// state it drives. Sits in App's persistent <footer>, so it is reachable from
// every ActivityContext.status, same as the header's load-activity controls.
import { useCallback, useState } from 'react'
import { markUsed } from '../lib/usage.js'
import { FeedbackDialog } from './FeedbackDialog.jsx'

export function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const handleRequestClose = useCallback(() => setIsOpen(false), [])
  const openFeedback = useCallback(() => {
    markUsed('feedback:open')
    setIsOpen(true)
  }, [])

  return (
    <div className="feedback-widget">
      <button type="button" className="feedback-trigger" onClick={openFeedback}>
        Feedback
      </button>
      <FeedbackDialog isOpen={isOpen} onRequestClose={handleRequestClose} />
    </div>
  )
}
