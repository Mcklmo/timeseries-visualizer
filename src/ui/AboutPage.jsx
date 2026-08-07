// Static blog-style page swapped into <main> while AppShell's showAbout is
// set — no router in this app, so "navigation" is plain state, same as the
// status-driven views. Presentational only; the back action is the caller's.
export function AboutPage({ onBack }) {
  return (
    <div className="about-page">
      <button type="button" className="about-page__back" onClick={onBack}>
        ← Back
      </button>
      <h2>About</h2>
      <p>
        Activity Visualiser runs entirely in your browser. Your files are never sent to a server —
        they stay on your machine, so your data never leaves your device. There are no cookies, no
        tracking, and no analytics. This is a non-profit project: nothing is recorded, collected,
        or sold.
      </p>
      <p>
        It reads <strong>TCX</strong>, <strong>FIT</strong> and <strong>GPX</strong> files, so
        anything from a training watch to a satellite messenger or a camera&apos;s location log can
        be charted. A GPX track carrying only position and elevation still gets speed and elevation
        panels — both are reconstructed from the positions themselves.
      </p>
      <p>
        I built Activity Visualiser as a mostly satisfied user of Garmin Connect and{' '}
        <a
          className="about-page__link"
          href="https://www.intervals.icu"
          target="_blank"
          rel="noreferrer noopener"
        >
          Intervals.icu
        </a>{' '}
        who found a few features missing from both. In particular, I wanted advanced statistics —
        such as average, minimum, and maximum reference lines — directly on each chart, and all
        charts stacked vertically on a shared timeline.
      </p>
    </div>
  )
}
