// The activity's identity, rendered inside <header> so it survives
// .app-header--faded and lands in a mid-scroll screenshot (§9's screenshot
// rule): the inferred name (domain/deriveWorkoutName.js, via
// normalizeActivity), a stable sport chip, when it was recorded, and how long
// the charts beside it cover. See ARCHITECTURE.md §0 for why the chip is
// activity.sport, not activity's richer FIT sportLabel — that would just
// duplicate the name.
//
// The duration follows the zoom, so a screenshot of a zoomed interval says how
// long *that* interval is. It shares ONE FUNCTION with the stat chips
// (elapsedTimeFor, in stats/statsBasis.js) rather than one basis object: the
// chips settle behind useDeferredValue and cannot move at framerate, while a
// duration that freezes for a whole pinch and only catches up on release reads
// as broken. So this number is live and the chips lag it mid-gesture; both are
// exact the moment the fingers stop, and statsBasis.test.js pins them to the
// same definition so they can never disagree about a settled window.
//
// The start time deliberately does not follow the zoom: it is what identifies
// the activity, and a clock that slid to the window's start would make two
// different claims in one cluster.
//
// The cluster carries one LIVE reading as well as that identity: the shared
// crosshair position, portaled in from the first visible panel. It is here
// rather than in the chart toolbar — where it started — because .app-header is
// sticky and .app-header__title is exempt from the scrolled fade, while the
// toolbar scrolls off the top with the rest of <main>. With four or five
// stacked panels, the label saying *where in the activity* the crosshair is had
// left the screen by the time you scrolled down to hover the bottom graph.
import { formatDuration, formatStartDateTime } from '../domain/units.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useStatsBasis } from '../stats/StatsBasisContext.jsx'

const SPORT_CHIP_LABEL = { running: 'Running', cycling: 'Cycling', track: 'Track' }

/**
 * @param {object} props
 * @param {(node: Element|null) => void} [props.positionRef] - callback ref for the shared
 *   `12:05 · 2.34 km` slot, owned by AppShell and filled by the first visible panel's
 *   CrosshairReadout.
 */
export function ActivityHeader({ positionRef }) {
  const { activity } = useActivity()
  const { elapsedTime } = useStatsBasis() // above the guard — rules of hooks
  if (!activity) return null

  const startedAt = formatStartDateTime(activity.startTime)

  return (
    <div className="activity-header">
      <h2>{activity.name}</h2>
      <span className="sport-chip">{SPORT_CHIP_LABEL[activity.sport]}</span>
      {startedAt && <span className="activity-datetime">{startedAt}</span>}
      {/* No aria-live: the stat chips don't announce on zoom either, and a
          polite region firing on every settle would be noise. */}
      <span className="activity-duration">{formatDuration(elapsedTime)}</span>
      {/* Last on purpose: the CSS separator in front of it is an adjacent-
          sibling rule on .activity-duration. Portal target, never given React
          children — same rule as MetricPanel's .crosshair-slot, and it is what
          makes the `:empty { display: none }` collapse reliable. Empty at rest
          on purpose: transient chrome stays out of an idle screenshot (§9), and
          this header is in every screenshot. */}
      <span className="crosshair-position" ref={positionRef} />
    </div>
  )
}
