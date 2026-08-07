// Neither FIT nor TCX embeds a genuine free-text activity title (that's a
// Garmin Connect database concept, not part of the file export), so a
// workout name is inferred from time-of-day + sport instead. See
// ARCHITECTURE.md §8 for the sportLabel provenance notes.

// Fairly arbitrary conventions (not derived from anything) — named here so a
// future reader knows that's intentional, not a magic number.
const MORNING_START_HOUR = 5
const AFTERNOON_START_HOUR = 12
const EVENING_START_HOUR = 17
const NIGHT_START_HOUR = 21

const ACTIVITY_LABEL_BY_SPORT = { running: 'Run', cycling: 'Ride' }

function timeOfDayLabel(date) {
  const hour = date.getHours() // local browser time — see ARCHITECTURE.md notes on this decision
  if (hour >= MORNING_START_HOUR && hour < AFTERNOON_START_HOUR) return 'Morning'
  if (hour >= AFTERNOON_START_HOUR && hour < EVENING_START_HOUR) return 'Afternoon'
  if (hour >= EVENING_START_HOUR && hour < NIGHT_START_HOUR) return 'Evening'
  return 'Night'
}

/**
 * @param {object} args
 * @param {import('./types.js').Sport} args.sport
 * @param {string} [args.sportLabel] - watch sport-profile name, FIT only (e.g. "Trail Run")
 * @param {Date} args.startTime
 * @returns {string}
 */
export function deriveWorkoutName({ sport, sportLabel, startTime }) {
  // Deliberately NOT case-normalized: trust the athlete's own watch-profile
  // naming verbatim rather than second-guessing it.
  const trimmedLabel = sportLabel?.trim()
  const activityLabel = trimmedLabel ? trimmedLabel : ACTIVITY_LABEL_BY_SPORT[sport]
  return `${timeOfDayLabel(startTime)} ${activityLabel}`
}
