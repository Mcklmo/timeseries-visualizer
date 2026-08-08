import { describe, it, expect } from 'vitest'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { derivativeStroke } from './derivativeStyle.js'

// The recipe STRINGS are what these assert, not rendered colours: jsdom does
// not resolve color-mix() (or the var() inside it), so there is nothing to
// compare pixels of. The measured oklab numbers behind the two directions live
// in the comment beside STEP_DARKER, the same way DERIV_DOMAIN_QUANTILE
// documents its fixture-measured values in MetricPanel.jsx.
describe('derivativeStroke', () => {
  it('steps a mid-lightness hue toward white', () => {
    expect(derivativeStroke(metricRegistry.heartRate)).toBe('color-mix(in oklab, var(--metric-heartrate) 72%, white)')
  })

  it('steps power darker instead, amber having no headroom left toward white', () => {
    // The bug this file exists for: amber sits at oklab L 0.880, so a 72% mix
    // toward white moves it 0.034 — a third of heart rate's step — and the two
    // power lines rendered 1.1:1 apart. Darker lands on #be9b4a, ΔL 0.176.
    expect(derivativeStroke(metricRegistry.power)).toBe('color-mix(in oklab, var(--metric-power) 80%, black)')
  })

  it('always moves off the hue it derives from, for every metric that offers a derivative', () => {
    // The generic guard, and the one that would have caught this class of bug
    // on the next metric rather than by eye: a rule stated as a fixed RATIO
    // produces a shrinking STEP as the hue runs out of room in that direction.
    // It says nothing about how far apart they are — jsdom cannot know that —
    // only that a metric can never get a derivative painted in its own colour.
    const withDerivative = Object.values(metricRegistry).filter((m) => m.derivative != null)
    expect(withDerivative.length).toBeGreaterThan(0)

    for (const metric of withDerivative) {
      expect(derivativeStroke(metric), metric.id).not.toBe(metric.color)
      expect(derivativeStroke(metric), metric.id).toContain(metric.color)
    }
  })
})
