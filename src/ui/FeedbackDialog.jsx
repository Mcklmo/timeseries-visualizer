// Native <dialog> shell for the feedback form — modal semantics, focus
// trapping and Escape-to-close come from the platform rather than being
// reimplemented.
//
// The <dialog> itself stays mounted always (a stable ref is what
// showModal()/close() are called on), but <FeedbackForm> is rendered only
// while open, so re-opening after a submit starts from clean form state
// instead of resurrecting the previous attempt.
import { useEffect, useRef } from 'react'
import { FeedbackForm } from './FeedbackForm.jsx'

export function FeedbackDialog({ isOpen, onRequestClose }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (isOpen) dialog.showModal()
    else dialog.close()
  }, [isOpen])

  // Attached by hand rather than as a JSX onClose prop: React's synthetic
  // handling of <dialog>'s native close/cancel events is inconsistent. This
  // also funnels the "×" button and a real Escape keypress through one path,
  // since both end in the same native `close` event.
  useEffect(() => {
    const dialog = dialogRef.current
    const handleClose = () => onRequestClose()
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [onRequestClose])

  return (
    <dialog ref={dialogRef} className="feedback-dialog" aria-labelledby="feedback-dialog-title">
      <div className="feedback-dialog__header">
        <h2 id="feedback-dialog-title">Send feedback</h2>
        <button
          type="button"
          className="feedback-dialog__close"
          aria-label="Close"
          onClick={() => dialogRef.current.close()}
        >
          ×
        </button>
      </div>
      {isOpen && <FeedbackForm />}
    </dialog>
  )
}
