// First and second derivative of a plotted metric — heart-rate ramp, climb
// rate, acceleration, power ramp. See ARCHITECTURE.md §6.
//
// A derivative is a SERIES, not a scalar, which is the whole reason it does not
// live in stats/aggregate.js next to max/min/avg/median: those are one number
// each, drawn as a horizontal ReferenceLine, and a horizontal line at
// "4.2 bpm/min" across a 120-170 bpm axis says nothing. The units genuinely
// differ from the metric's own, hence the second y-axis in MetricPanel.
//
// Pure and React-free, per the domain/ dependency rule (§4). The closest
// relative is deriveSpeed.js — that is also a d/dt (of distance) and this file
// deliberately mirrors its shape and reuses its smoothing window.
import { smooth, smoothWindowSamplesFor } from './smooth.js'

/**
 * One differentiation pass: centred difference, smoothed at the recording's
 * own cadence.
 *
 * CENTRED rather than deriveSpeed's backward difference because this result is
 * *displayed against the metric it came from*. A backward difference carries a
 * half-sample phase lag, which would put the derivative's zero crossing beside
 * the metric's peak rather than on it — and that crossing (where the heart rate
 * stops climbing, where the ascent tops out) is the landmark the overlay exists
 * to show. deriveSpeed has no such constraint: nothing is drawn beneath it.
 *
 * @param {(number|null|undefined)[]} values
 * @param {number[]} t - seconds since start, one per value
 * @param {object} args
 * @param {number} args.intervalS - the recording's median sample interval
 * @param {number} args.gapThresholdS - a t span above this is a dropout, not an interval
 * @returns {(number|null)[]} same length as `values`, in value-units per second
 */
function differentiateOnce(values, t, { intervalS, gapThresholdS }) {
  const n = values.length
  // A single point has no neighbour to difference against, and an empty series
  // has nothing at all. Both are `null`, never 0 — see the note below.
  if (n < 2) return values.map(() => null)

  const raw = values.map((_, i) => {
    // One-sided at the two ends, centred everywhere else. The ends are the only
    // samples with a missing neighbour, so this is the whole special case.
    const lo = i === 0 ? 0 : i - 1
    const hi = i === n - 1 ? n - 1 : i + 1
    const a = values[lo]
    const b = values[hi]

    // A null must never be read as zero: a missing channel is "no rate known
    // here", and a 0 would draw a confident flat line saying the metric was
    // steady. connectNulls={false} turns this into a real break in the overlay.
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null

    const dt = t[hi] - t[lo]
    if (!(dt > 0)) return null
    // A difference measured across a six-hour satellite dropout
    // (fixtures/sparse-multiday.gpx) is not a rate — it is two unrelated
    // readings divided by the time between them. Same threshold pause
    // detection and the chart's own gap breaks use, so all three agree on
    // where a gap is.
    if (dt > gapThresholdS) return null

    return (b - a) / dt
  })

  // At breadcrumb cadences the window collapses to a single sample: a delta
  // measured over ten minutes is already an average and there is nothing left
  // to smooth. Branch explicitly rather than relying on smooth(x, 1) being a
  // no-op — it also maps non-finite values to null, which is not a behaviour to
  // inherit by accident. (Identical reasoning, and identical branch, to
  // deriveSpeed.js.)
  const windowSamples = smoothWindowSamplesFor(intervalS)
  if (windowSamples === 1) return raw

  return smooth(raw, windowSamples)
}

/**
 * @param {(number|null|undefined)[]} values - the metric's own samples, via metric.accessor
 * @param {number[]} t - seconds since start, one per value
 * @param {object} args
 * @param {1|2} [args.order] - 1 for d/dt, 2 for d²/dt²
 * @param {number} [args.intervalS] - the recording's median sample interval
 * @param {number} args.gapThresholdS - from domain/samplingInterval.js's gapThresholdFor
 * @returns {(number|null)[]} same length as `values`, in value-units per second
 *   (per second SQUARED at order 2) — MetricPanel scales to display units via
 *   the registry's `perSecondScale`.
 */
export function derivativeSeries(values, t, { order = 1, intervalS = 1, gapThresholdS }) {
  // Order 2 is the whole pipeline applied to order 1's output, so it is
  // smoothed twice — deliberately. Differentiating twice roughly squares the
  // noise, and a raw d² of 1 Hz watch data is an unreadable hairball.
  let series = values
  for (let pass = 0; pass < order; pass++) {
    series = differentiateOnce(series, t, { intervalS, gapThresholdS })
  }
  return series
}
