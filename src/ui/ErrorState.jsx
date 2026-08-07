// Shown while ActivityContext.status is 'error' — the injected ActivitySource
// rejected (bad file, unsupported format, ...). Surfaces the error's own
// message rather than a generic one, since adapters throw specific reasons.
export function ErrorState({ error, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <h2>Couldn't load that activity</h2>
      <p>{error.message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
