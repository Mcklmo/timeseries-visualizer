// The activity's identity, rendered inside <header> so it survives
// .app-header--faded and lands in a mid-scroll screenshot (§9's screenshot
// rule): the inferred name (domain/deriveWorkoutName.js, via
// normalizeActivity), a stable sport chip, when it was recorded, and how long
// the charts beside it cover. See ARCHITECTURE.md §0 for why the chip is
// activity.sport, not activity's richer FIT sportLabel — that would just
// duplicate the name.
//
// The duration follows the zoom, exactly like the stat chips and from the same
// basis, so a screenshot of a zoomed interval says how long *that* interval
// is. The start time deliberately does not: it is what identifies the
// activity, and a clock that slid to the window's start would make two
// different claims in one cluster.
import { formatDuration, formatStartDateTime } from '../domain/units.js'
import { useActivity } from '../state/ActivityContext.jsx'
import { useStatsBasis } from '../stats/StatsBasisContext.jsx'

const SPORT_CHIP_LABEL = { running: 'Running', cycling: 'Cycling', track: 'Track' }

export function ActivityHeader() {
  const { activity } = useActivity()
  const { basis } = useStatsBasis() // above the guard — rules of hooks
  if (!activity) return null

  const startedAt = formatStartDateTime(activity.startTime)

  return (
    <div className="activity-header">
      <h2>{activity.name}</h2>
      <span className="sport-chip">{SPORT_CHIP_LABEL[activity.sport]}</span>
      {startedAt && <span className="activity-datetime">{startedAt}</span>}
      {/* No aria-live: the stat chips don't announce on zoom either, and a
          polite region firing on every settle would be noise. */}
      <span className="activity-duration">
        {formatDuration(basis?.elapsedTime ?? activity.totalTime ?? 0)}
      </span>
    </div>
  )
}
