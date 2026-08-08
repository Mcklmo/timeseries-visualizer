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
import { metricRegistry, metricUnit, statKinds } from '../metrics/metricRegistry.js'
import { computeYDomain } from '../stats/aggregate.js'
import { useMetricStats } from '../stats/useMetricStats.js'
import { CHART_MARGIN, Y_AXIS_WIDTH } from './chartGeometry.js'
import { SyncedTooltip } from './SyncedTooltip.jsx'

// Y_AXIS_WIDTH and CHART_MARGIN are imported, not declared here, because the
// pinch gesture measures the plot area by subtracting exactly these numbers
// from the chart's rect (see chartGeometry.js). Two copies would drift and the
// gesture would quietly grab a few pixels off the line it looks like it's on.
const SYNC_ID = 'activity'

// Draw order comes from the registry's `statKinds`; the dash patterns stay
// here, being presentation rather than domain.
const STAT_DASH = { max: '4 4', min: '1 2', avg: undefined, median: '2 3' }

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
export function MetricPanel({ activity, metricId, xMode, zoomDomain, statsBasis, enabledStats, showXAxis, height }) {
  const metric = metricRegistry[metricId]
  const stats = useMetricStats(statsBasis, metricId)
  const xKey = xMode === 'distance' ? 'd' : 't'

  // Every panel builds its rows from the same samples with the same gap
  // threshold, so the synthetic break rows land at the same index in all of
  // them. That still matters after the Brush's removal: Recharts' syncId
  // pairs panels by data index, so a row present in one panel and absent from
  // another would put the shared crosshair on different samples per panel.
  const data = useMemo(() => {
    const rows = activity.samples.map((s) => ({ t: s.t, d: s.d, [metricId]: metric.accessor(s) }))
    return insertGapBreaks(rows, { metricId, gapThresholdS: gapThresholdFor(activity.samplingIntervalS) })
  }, [activity.samples, activity.samplingIntervalS, metricId, metric])

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

  const statEntries = statKinds.filter((kind) => enabledStats.includes(kind) && stats[kind] != null).map(
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
          <Tooltip
            content={<SyncedTooltip metric={metric} sport={activity.sport} />}
            cursor={{ stroke: 'var(--stat-line)' }}
            isAnimationActive={false}
          />
          {statEntries.map(({ kind, value }) => (
            <ReferenceLine key={kind} y={value} stroke="var(--stat-line)" strokeDasharray={STAT_DASH[kind]} />
          ))}
          <Line
            dataKey={metricId}
            stroke={metric.color}
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
