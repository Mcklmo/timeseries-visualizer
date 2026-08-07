// Renders the inferred name (domain/deriveWorkoutName.js, via
// normalizeActivity) plus a stable sport chip. See ARCHITECTURE.md §0 for
// why the chip is activity.sport, not activity's richer FIT sportLabel —
// that would just duplicate the name.
import { useActivity } from '../state/ActivityContext.jsx'

const SPORT_CHIP_LABEL = { running: 'Running', cycling: 'Cycling' }

export function ActivityHeader() {
  const { activity } = useActivity()
  if (!activity) return null

  return (
    <div className="activity-header">
      <h2>{activity.name}</h2>
      <span className="sport-chip">{SPORT_CHIP_LABEL[activity.sport]}</span>
    </div>
  )
}
