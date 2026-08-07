// Footer entry point for the feedback flow: the trigger plus the open/closed
// state it drives. Sits in App's persistent <footer>, so it is reachable from
// every ActivityContext.status, same as the header's load-activity controls.
import { useCallback, useState } from 'react'
import { FeedbackDialog } from './FeedbackDialog.jsx'

export function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const handleRequestClose = useCallback(() => setIsOpen(false), [])

  return (
    <div className="feedback-widget">
      <button type="button" className="feedback-trigger" onClick={() => setIsOpen(true)}>
        Feedback
      </button>
      <FeedbackDialog isOpen={isOpen} onRequestClose={handleRequestClose} />
    </div>
  )
}
