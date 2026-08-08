// The date-range control above the intervals.icu activity list: three preset
// chips and two day fields. Presentational and fully controlled — IntervalsPage
// owns the range and does all the fetching, exactly as IntervalsActivityList is
// a pure renderer of rows it never asked for.
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
  EMPTY_RANGE,
  PRESETS,
  isRangeActive,
  isValidRange,
} from '../data/intervals/activityDateRange.js'
import { toApiDate } from '../data/intervals/intervalsApi.js'

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

  const today = toApiDate(new Date())
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
          const preset = rangeFor(new Date())
          return (
            <button
              key={id}
              type="button"
              className="intervals-date-filter__preset"
              // Pressed reflects the range, not the last button tapped: a
              // preset typed by hand into the two fields still reads as
              // active, and the state stays the single source of truth.
              aria-pressed={range.from === preset.from && range.to === preset.to}
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

      {/* Mirrors the search box's ✕ — same affordance, same touch floor, for
          the same reason: a date input's own clear control exists on some
          platforms and not others. */}
      {isRangeActive(range) && (
        <button
          type="button"
          className="intervals-date-filter__clear"
          aria-label="Clear date range"
          onClick={() => onChange(EMPTY_RANGE)}
        >
          ✕
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
