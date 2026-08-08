import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EMPTY_RANGE, PRESETS } from '../data/intervals/activityDateRange.js'
import { toApiDate } from '../data/intervals/intervalsApi.js'
import { IntervalsDateFilter } from './IntervalsDateFilter.jsx'

// userEvent.type is unreliable against type="date" in jsdom (it drives the
// segmented editor, which jsdom does not implement); a change event is what
// the real control emits once a day is picked anyway.
const setDay = (input, value) => fireEvent.change(input, { target: { value } })

function renderFilter(range = EMPTY_RANGE) {
  const onChange = vi.fn()
  render(<IntervalsDateFilter range={range} onChange={onChange} />)
  return onChange
}

const fromField = () => screen.getByLabelText('From')
const toField = () => screen.getByLabelText('To')

describe('IntervalsDateFilter', () => {
  it('renders two real date inputs, labelled', () => {
    renderFilter()
    expect(fromField()).toHaveAttribute('type', 'date')
    expect(toField()).toHaveAttribute('type', 'date')
  })

  it('reports a picked day as a YYYY-MM-DD string, keeping the other bound', () => {
    const onChange = renderFilter({ from: null, to: '2026-03-31' })

    setDay(fromField(), '2026-03-01')

    expect(onChange).toHaveBeenCalledWith({ from: '2026-03-01', to: '2026-03-31' })
  })

  // Emptying a field means "no bound" — the same shape EMPTY_RANGE has, not an
  // empty string, which is falsy but present and would confuse the predicate.
  it('clears a single bound back to null', () => {
    const onChange = renderFilter({ from: '2026-03-01', to: '2026-03-31' })

    setDay(toField(), '')

    expect(onChange).toHaveBeenCalledWith({ from: '2026-03-01', to: null })
  })

  it('sets both bounds from a preset and shows it as the pressed one', () => {
    const onChange = renderFilter()

    fireEvent.click(screen.getByRole('button', { name: '3 months' }))

    const expected = PRESETS.find((p) => p.id === '3m').rangeFor(new Date())
    expect(onChange).toHaveBeenCalledWith(expected)

    // pressed follows the range, not the click: re-rendered with that range,
    // the chip reads as active without the component holding any state
    render(<IntervalsDateFilter range={expected} onChange={() => {}} />)
    const chips = screen.getAllByRole('button', { name: '3 months' })
    expect(chips[chips.length - 1]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { name: '30 days' }).pop()).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('groups the presets so they announce as one control', () => {
    renderFilter()
    expect(screen.getByRole('group', { name: /date range presets/i })).toBeInTheDocument()
  })

  it('offers the ✕ only once a range is set, and clears both bounds with it', () => {
    renderFilter()
    expect(screen.queryByRole('button', { name: /clear date range/i })).not.toBeInTheDocument()

    const onChange = renderFilter({ from: '2026-03-01', to: null })
    fireEvent.click(screen.getByRole('button', { name: /clear date range/i }))

    expect(onChange).toHaveBeenCalledWith(EMPTY_RANGE)
  })

  // The native calendar greys these days out itself, which is most of the
  // validation this control needs.
  it('bounds each field by the other and by today', () => {
    const today = toApiDate(new Date())
    renderFilter({ from: '2026-03-01', to: '2026-03-31' })

    expect(fromField()).toHaveAttribute('max', '2026-03-31')
    expect(toField()).toHaveAttribute('min', '2026-03-01')
    expect(toField()).toHaveAttribute('max', today)
  })

  it('caps the from-field at today when no end date narrows it further', () => {
    const today = toApiDate(new Date())
    renderFilter({ from: null, to: null })
    expect(fromField()).toHaveAttribute('max', today)
  })

  // min/max only govern the picker; typing goes straight past them, so the
  // invalid state has to be announced rather than merely prevented.
  it('marks both fields invalid and says why when the end precedes the start', () => {
    renderFilter({ from: '2026-03-31', to: '2026-03-01' })

    expect(fromField()).toHaveAttribute('aria-invalid', 'true')
    expect(toField()).toHaveAttribute('aria-invalid', 'true')
    const message = screen.getByRole('alert')
    expect(message).toHaveTextContent(/end date is before the start date/i)
    expect(fromField()).toHaveAttribute('aria-describedby', message.id)
    expect(toField()).toHaveAttribute('aria-describedby', message.id)
  })

  it('says nothing about validity for a range that is fine', () => {
    renderFilter({ from: '2026-03-01', to: '2026-03-31' })

    expect(fromField()).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
