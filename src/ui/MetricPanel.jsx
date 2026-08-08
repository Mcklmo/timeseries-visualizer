// One stacked chart panel for a single metric. See ARCHITECTURE.md §7.
// Every panel shares syncId, XAxis dataKey/domain, and YAxis width with its
// siblings in ChartStack so plot areas align pixel-for-pixel and the
// tooltip/crosshair stays in sync across the whole stack.
import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { insertGapBreaks } from '../domain/insertGapBreaks.js'
import { gapThresholdFor } from '../domain/samplingInterval.js'
import { makeDistanceTickFormatter, makeElapsedTickFormatter } from '../domain/units.js'
import { isFullDomain } from '../domain/zoomDomain.js'
import { derivativeKindFor, metricRegistry, metricUnit, scalarStatKinds } from '../metrics/metricRegistry.js'
import { computeYDomain } from '../stats/aggregate.js'
import { useDerivativeSeries } from '../stats/useDerivativeSeries.js'
import { useMetricStats } from '../stats/useMetricStats.js'
import { CHART_MARGIN, Y_AXIS_WIDTH } from './chartGeometry.js'
import { derivativeStroke } from './derivativeStyle.js'
import { SyncedTooltip } from './SyncedTooltip.jsx'

// Y_AXIS_WIDTH and CHART_MARGIN are imported, not declared here, because the
// pinch gesture measures the plot area by subtracting exactly these numbers
// from the chart's rect (see chartGeometry.js). Two copies would drift and the
// gesture would quietly grab a few pixels off the line it looks like it's on.
const SYNC_ID = 'activity'

// Draw order comes from the registry's `scalarStatKinds`; the dash patterns
// stay here, being presentation rather than domain. Scalar kinds only —
// a derivative is a series on its own axis, not a horizontal reference line.
const STAT_DASH = { max: '4 4', min: '1 2', avg: undefined, median: '2 3' }

// Both weights live here, adjacent, because the RATIO between them is the
// design: the measured metric is the subject of the panel and the derivative
// is an annotation on it, so the main line is the heavier mark and paints on
// top. Stated explicitly rather than left to Recharts' default of 1 — the
// previous version set a 4.5px overlay against that invisible default and
// inverted the hierarchy. See ARCHITECTURE.md §7.
const MAIN_STROKE_WIDTH = 1.75
const DERIV_STROKE_WIDTH = 1.25

// Recharts binds a <Line>/<YAxis>/<ReferenceLine> to an axis by `yAxisId`,
// which DEFAULTS TO 0 on all three (their own defaultProps). While there was
// one axis that default was invisible; with two, anything left implicit
// attaches to whichever axis Recharts resolves first. Hence every mark below
// names its axis explicitly, including the pre-existing ones.
const VALUE_AXIS = 'value'
const DERIV_AXIS = 'deriv'

/** The overlay's row key. Namespaced under the metric so it cannot collide
 *  with another metric's id in the shared row objects. */
const derivKeyFor = (metricId) => `${metricId}:d`

// Matches the registry's `domainPadding` convention for the left axis.
const DERIV_DOMAIN_PADDING = 0.08

// The derivative axis is scaled to this quantile of |rate|, NOT to the maximum.
//
// Measured on fixtures/23870166877_ACTIVITY.fit (1801 samples, 1 Hz): heart-rate
// ramp runs ±13 bpm/min at the median and ±33 at p90, but peaks at 227 during
// the eight seconds at the start of the run where HR climbs 77 → 108. That peak
// is real data, not a sensor artifact — which is exactly why scaling to it is
// wrong: one genuine burst would squash the other 99% of the trace into the
// middle few percent of the panel, and the overlay exists to be read. d² is
// worse again (±1378 against a median near zero), since differentiating twice
// roughly squares the noise.
//
// The clipped tail is not lost information: `allowDataOverflow` is on, so a
// spike draws out to the plot edge and back rather than vanishing.
const DERIV_DOMAIN_QUANTILE = 0.99

// Plain-HTML summary row below the chart — a flex row naturally avoids
// overlap between stat values, unlike the old SVG-positioned labels.
function StatSummary({ metric, entries, sport }) {
  if (entries.length === 0) return null
  const unit = metricUnit(metric, sport)

  return (
    <div className="stat-summary">
      {entries.map(({ kind, value }) => (
        <span key={kind} className="stat-chip">
          {kind.toUpperCase()} {metric.format(value)} {unit}
        </span>
      ))}
    </div>
  )
}

// `statsBasis` is built once for the whole stack by ChartStack (stats/statsBasis.js)
// and carries the zoom window with it — the panel neither slices nor knows it
// is zoomed, it just reports on what it was handed.
export function MetricPanel({
  activity,
  metricId,
  xMode,
  zoomDomain,
  statsBasis,
  enabledStats,
  // MUST default to 0. ChartStack always passes it, but ~fifteen panel tests
  // render from a DEFAULT_PROPS object that does not — and `width={undefined}`
  // on the right <YAxis> makes Recharts substitute its own DEFAULT_Y_AXIS_WIDTH
  // of 60, laying the panel out 60px narrower than the gesture believes. Same
  // default, same reason, as chartGeometry's `rightInset`.
  rightInset = 0,
  showXAxis,
  height,
}) {
  const metric = metricRegistry[metricId]
  const stats = useMetricStats(statsBasis, metricId)
  const xKey = xMode === 'distance' ? 'd' : 't'

  // At most one, guaranteed by ChartViewContext's toggleStat: one right axis
  // carries one unit, and on a 375px phone one overlay is the only variant that
  // leaves usable plot width. The SAME helper ChartStack sizes the gutter with,
  // so this panel draws an overlay exactly when the stack reserved room for it.
  const derivKind = derivativeKindFor(metric, enabledStats)
  const derivSpec = derivKind == null ? null : metric.derivative[derivKind]
  const derivSeries = useDerivativeSeries(activity, metricId, derivKind)
  const derivKey = derivKeyFor(metricId)
  // `rightInset > 0` is an interlock, not a second opinion: ChartStack derives
  // the gutter from the same derivativeKindFor call, so in the app this is
  // always true when the rest is. It matters because the failure it rules out
  // is invisible — an overlay whose `yAxisId` names an axis nothing rendered
  // does NOT error; Recharts invents that axis at its own DEFAULT_Y_AXIS_WIDTH
  // of 60, and the panel silently lays out 60px narrower than the gesture
  // believes. A missing overlay is a visible bug; that one is not.
  const hasOverlay = derivSeries != null && derivSpec != null && rightInset > 0
  // One value for the stroke, the axis it reads against, and the checkbox that
  // switched it on — see derivativeStyle.js.
  const derivColor = derivativeStroke(metric)

  // Every panel builds its rows from the same samples with the same gap
  // threshold, so the synthetic break rows land at the same index in all of
  // them. That still matters after the Brush's removal: Recharts' syncId
  // pairs panels by data index, so a row present in one panel and absent from
  // another would put the shared crosshair on different samples per panel.
  const data = useMemo(() => {
    const rows = activity.samples.map((s) => ({ t: s.t, d: s.d, [metricId]: metric.accessor(s) }))
    // Merged BEFORE insertGapBreaks, which shifts every index past the first
    // gap: `derivSeries` is indexed by SAMPLE, and the rows stop being
    // sample-indexed the moment a synthetic row is spliced in.
    if (hasOverlay) {
      for (let i = 0; i < rows.length; i++) {
        const v = derivSeries[i]
        // Scaled from the domain function's per-second units to the ones the
        // registry labels the axis with (bpm/min, m/min, m/s²...).
        rows[i][derivKey] = v == null ? null : v * derivSpec.perSecondScale
      }
    }
    return insertGapBreaks(rows, {
      valueKeys: hasOverlay ? [metricId, derivKey] : [metricId],
      gapThresholdS: gapThresholdFor(activity.samplingIntervalS),
    })
  }, [activity.samples, activity.samplingIntervalS, metricId, metric, hasOverlay, derivSeries, derivSpec, derivKey])

  const xTickFormatter = useMemo(
    () =>
      xMode === 'distance'
        ? makeDistanceTickFormatter(activity.totalDistance)
        : makeElapsedTickFormatter(activity.totalTime),
    [xMode, activity.totalDistance, activity.totalTime],
  )

  // Whole-activity on purpose, unlike the stats above: a y-axis that rescaled
  // to the window would make the line jitter vertically through a pinch, and
  // the windowed reference lines still land inside this fixed range — which is
  // the point of keeping it fixed.
  const yDomain = useMemo(() => computeYDomain({ samples: activity.samples, metric }), [activity.samples, metric])

  // Symmetric about zero, and over the whole activity for exactly the reason
  // yDomain is: a range that rescaled with the window would make the overlay
  // jitter vertically through a pinch. Symmetry is the extra requirement here —
  // it fixes zero to the panel's vertical centre, so "still climbing" vs
  // "falling away" reads off the line's position without consulting the ticks.
  const derivDomain = useMemo(() => {
    if (!hasOverlay) return undefined
    const magnitudes = []
    for (const v of derivSeries) {
      if (v == null || !Number.isFinite(v)) continue
      magnitudes.push(Math.abs(v))
    }
    magnitudes.sort((a, b) => a - b)
    const quantile = magnitudes.length === 0 ? 0 : magnitudes[Math.floor((magnitudes.length - 1) * DERIV_DOMAIN_QUANTILE)]
    // A perfectly flat metric (or an all-null channel) has no magnitude to
    // scale to, and [0, 0] is a degenerate axis — give the zero line somewhere
    // to sit. The padding keeps the extremes off the plot edge, where half the
    // stroke would be clipped.
    const m = quantile > 0 ? quantile * derivSpec.perSecondScale * (1 + DERIV_DOMAIN_PADDING) : 1
    return [-m, m]
  }, [hasOverlay, derivSeries, derivSpec])

  const statEntries = scalarStatKinds.filter((kind) => enabledStats.includes(kind) && stats[kind] != null).map(
    (kind) => ({ kind, value: stats[kind] }),
  )

  return (
    <div className="metric-panel" style={{ minHeight: height }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId={SYNC_ID} margin={CHART_MARGIN}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            type="number"
            dataKey={xKey}
            domain={zoomDomain}
            hide={!showXAxis}
            interval={0}
            tickFormatter={xTickFormatter}
            // WITHOUT THIS, A NUMERIC domain DOES NOTHING. Recharts'
            // extendDomain() (util/isDomainSpecifiedByUser.js) widens any
            // user-supplied domain back out to the data extent unless
            // allowDataOverflow is set — silently, with no error. Same reason
            // the YAxis below sets it. It also switches on Recharts' plot-rect
            // clipPath, so the line clips at the plot edge instead of drawing
            // into the axis gutter.
            //
            // Conditional rather than unconditional so the unzoomed render
            // stays byte-identical to what it was before zoom existed.
            allowDataOverflow={!isFullDomain(zoomDomain)}
          />
          <YAxis
            yAxisId={VALUE_AXIS}
            width={Y_AXIS_WIDTH}
            reversed={!!metric.invertAxis}
            tickFormatter={metric.format}
            interval={0}
            domain={yDomain}
            // Without this, Recharts silently re-expands an explicit domain to cover
            // any out-of-range plotted point (e.g. a paused cadence=0 sample, excluded
            // from yDomain's calc but still present in `data`), which would undo the zoom.
            allowDataOverflow={yDomain != null}
          />
          {/* Rendered off the STACK-WIDE `rightInset`, not off this panel's own
              overlay: a panel with no derivative still has to reserve the same
              gutter, or its plot area would be 44px wider than its siblings'
              and the synced crosshair would land on a different screen x in
              each. Ticks and axis line are what switch off when this
              particular panel has nothing to label — Recharts' right-offset
              arithmetic (selectRightAxesOffset) sums `width` over every
              non-hidden, non-mirrored right axis and never reads `tick` or
              `axisLine`, so a tick-less axis still claims its width. `hide`
              and `mirror` are the two props that WOULD drop it; neither is
              passed. `width` must stay numeric for the same reason: the
              re-measure path bails on anything but "auto", so a number is
              fixed forever, while "auto" would let tick text decide the gutter
              and desync the panels. */}
          {rightInset > 0 && (
            <YAxis
              yAxisId={DERIV_AXIS}
              orientation="right"
              width={rightInset}
              domain={derivDomain}
              allowDataOverflow={derivDomain != null}
              // Tinted to the overlay's own stroke: this is what tells the
              // reader which of the two axes the pale line reads against. It
              // is also the discoverability cue the 4.5px casing was reaching
              // for — and it costs no ink inside the plot area.
              tick={hasOverlay ? { fill: derivColor } : false}
              tickLine={hasOverlay ? { stroke: derivColor } : false}
              axisLine={hasOverlay ? { stroke: derivColor } : false}
              tickFormatter={derivSpec?.format}
              interval={0}
            />
          )}
          <Tooltip
            content={
              <SyncedTooltip
                metric={metric}
                sport={activity.sport}
                derivative={hasOverlay ? { key: derivKey, spec: derivSpec } : null}
              />
            }
            cursor={{ stroke: 'var(--stat-line)' }}
            isAnimationActive={false}
          />
          {statEntries.map(({ kind, value }) => (
            <ReferenceLine
              key={kind}
              yAxisId={VALUE_AXIS}
              y={value}
              stroke="var(--stat-line)"
              strokeDasharray={STAT_DASH[kind]}
            />
          ))}
          {/* The zero crossing is the landmark the overlay exists to show:
              where the heart rate stops climbing, where the ascent tops out. */}
          {hasOverlay && <ReferenceLine yAxisId={DERIV_AXIS} y={0} stroke="var(--stat-line)" />}
          {/* Painted BEFORE the main line — Recharts paints children in order,
              so the metric a rate is derived FROM occludes it, not the reverse.
              A lighter step of that metric's own hue and a thinner stroke: §9
              allows one hue per metric, and this IS that metric, seen as a
              rate. Solid — a derivative is noisy by construction (see
              DERIV_DOMAIN_QUANTILE above) and a dash on a high-frequency trace
              turns to mush; the previous 3 3 dash is one of the three reasons
              this line could not be found at all. The same colour tints the
              right-hand axis it reads against and the d/dt checkbox that
              switched it on. */}
          {hasOverlay && (
            <Line
              className="deriv-line"
              yAxisId={DERIV_AXIS}
              dataKey={derivKey}
              stroke={derivColor}
              strokeWidth={DERIV_STROKE_WIDTH}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}
          <Line
            className="metric-line"
            yAxisId={VALUE_AXIS}
            dataKey={metricId}
            stroke={metric.color}
            strokeWidth={MAIN_STROKE_WIDTH}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <StatSummary metric={metric} entries={statEntries} sport={activity.sport} />
    </div>
  )
}
