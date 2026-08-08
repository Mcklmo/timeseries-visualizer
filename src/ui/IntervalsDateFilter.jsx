// The date-range control above the intervals.icu activity list: three preset
// chips and two day fields. Presentational and fully controlled —
// useIntervalsActivities owns the range and does all the fetching, exactly as
// ActivityRowList is a pure renderer of rows it never asked for.
//
// **Native `<input type="date">`, not a dependency and not a hand-rolled
// calendar.** It brings a real calendar on desktop, the OS wheel on iOS and
// Android, keyboard entry, localised display, and `min`/`max` that grey out
// invalid days *inside* the picker — for zero bytes, in an app whose four
// runtime dependencies are react, react-dom, recharts and the Garmin FIT SDK.
// Two CSS lines do the rest of the work (`color-scheme: dark` and a 16px font
// size); see .intervals-date-filter__input in global.css.
//
// Values are `YYYY-MM-DD` strings throughout, which is both what `input.value`
// reads and writes and what the API wants — see activityDateRange.js for why
// that choice removes the timezone class of bug entirely.
import { useId } from 'react'
import {
  DEFAULT_RANGE_DAYS,
  PRESETS,
  defaultRange,
  isSameRange,
  isValidRange,
  toApiDate,
} from '../data/activityDateRange.js'

/**
 * @param {{range: {from: string | null, to: string | null}, onChange: (range: object) => void}} props
 */
export function IntervalsDateFilter({ range, onChange }) {
  // useId, not hardcoded ids: this component is mounted once today, but the
  // hardcoded pair in FileDropZone had to be undone for exactly this reason
  // once a second instance appeared. Cheaper to get right now.
  const fromId = useId()
  const toId = useId()
  const errorId = useId()

  // The day is computed once and threaded everywhere below, so every
  // comparison in one render is against the same day — a fresh `new Date()`
  // per chip could straddle midnight and make two of them disagree.
  const todayDate = new Date()
  const today = toApiDate(todayDate)
  const theDefault = defaultRange(todayDate)
  const isValid = isValidRange(range)
  // Bounds so the native calendar itself refuses an inverted range. `today`
  // caps both because there are no future activities to browse — and it caps
  // the from-field even when `to` was typed past it, which `min`/`max` alone
  // would otherwise let through.
  const fromMax = range.to && range.to < today ? range.to : today
  const invalidProps = isValid ? {} : { 'aria-invalid': 'true', 'aria-describedby': errorId }

  // An empty field means "no bound", not the empty string — a cleared input
  // has to return the range to the same shape EMPTY_RANGE has, or the
  // predicate and the request bounds both see a falsy-but-present value.
  const setBound = (key) => (event) => onChange({ ...range, [key]: event.target.value || null })

  return (
    <div className="intervals-date-filter">
      <div className="intervals-date-filter__presets" role="group" aria-label="Date range presets">
        {PRESETS.map(({ id, label, rangeFor }) => {
          const preset = rangeFor(todayDate)
          return (
            <button
              key={id}
              type="button"
              className="intervals-date-filter__preset"
              // Pressed reflects the range, not the last button tapped: a
              // preset typed by hand into the two fields still reads as
              // active, and the state stays the single source of truth. It is
              // also what makes *3 months* read as pressed on first paint,
              // which is how the athlete is told the filter is already on.
              aria-pressed={isSameRange(range, preset)}
              onClick={() => onChange(preset)}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="intervals-date-filter__field">
        <label htmlFor={fromId}>From</label>
        <input
          id={fromId}
          type="date"
          className="intervals-date-filter__input"
          value={range.from ?? ''}
          max={fromMax}
          onChange={setBound('from')}
          {...invalidProps}
        />
      </div>

      <div className="intervals-date-filter__field">
        <label htmlFor={toId}>To</label>
        <input
          id={toId}
          type="date"
          className="intervals-date-filter__input"
          value={range.to ?? ''}
          min={range.from ?? undefined}
          max={today}
          onChange={setBound('to')}
          {...invalidProps}
        />
      </div>

      {/* Reset, not clear — there is no "filtering off" state to return to,
          so this puts the last 90 days back. It keeps the search box's ✕
          class (and with it the shared touch floor) though the affordance has
          diverged: that one empties a field, this one restores a default.

          Shown only once the range differs from that default. A reset button
          that is always there and sometimes a no-op is worse than one that
          appears exactly when there is something to undo. */}
      {!isSameRange(range, theDefault) && (
        <button
          type="button"
          className="intervals-date-filter__clear"
          aria-label={`Reset to the last ${DEFAULT_RANGE_DAYS} days`}
          onClick={() => onChange(theDefault)}
        >
          ↺
        </button>
      )}

      {/* Typing bypasses min/max, so the invalid state has to be stated rather
          than merely prevented. Same aria-invalid + aria-describedby pattern
          as IntervalsConnectForm and FeedbackForm. */}
      {!isValid && (
        <p className="intervals-date-filter__error" id={errorId} role="alert">
          The end date is before the start date.
        </p>
      )}
    </div>
  )
}
