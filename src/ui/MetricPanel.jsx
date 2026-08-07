// One stacked chart panel for a single metric. See ARCHITECTURE.md §7.
// Every panel shares syncId, XAxis dataKey/domain, and YAxis width with its
// siblings in ChartStack so plot areas align pixel-for-pixel and the
// tooltip/crosshair stays in sync across the whole stack.
import { useMemo } from 'react'
import { Brush, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { metricRegistry, metricUnit } from '../metrics/metricRegistry.js'
import { computeYDomain } from '../stats/aggregate.js'
import { useMetricStats } from '../stats/useMetricStats.js'
import { SyncedTooltip } from './SyncedTooltip.jsx'

const SYNC_ID = 'activity'
const Y_AXIS_WIDTH = 56 // matches --y-axis-width token; fixed so panels align

const STAT_ORDER = ['max', 'avg', 'median']
const STAT_DASH = { max: '4 4', avg: undefined, median: '2 3' }
const BRUSH_HEIGHT = 24

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

export function MetricPanel({
  activity,
  metricId,
  xMode,
  zoomDomain,
  enabledStats,
  showXAxis,
  showBrush,
  onZoomChange,
  height,
}) {
  const metric = metricRegistry[metricId]
  const stats = useMetricStats(activity, metricId)
  const xKey = xMode === 'distance' ? 'd' : 't'

  const data = useMemo(
    () => activity.samples.map((s) => ({ t: s.t, d: s.d, [metricId]: metric.accessor(s) })),
    [activity.samples, metricId, metric],
  )

  const yDomain = useMemo(() => computeYDomain({ samples: activity.samples, metric }), [activity.samples, metric])

  // Recharts' <Brush> tracks its own selected index range independently of
  // our zoomDomain (it drives what 'dataMin'/'dataMax' resolve to for every
  // synced panel). Left uncontrolled, that index range survives an xMode
  // switch even after zoomDomain resets, silently re-narrowing the "full"
  // domain to whatever was last brushed. Deriving indices from zoomDomain
  // keeps the two in lockstep.
  const lastIndex = data.length - 1
  const [zoomStart, zoomEnd] = zoomDomain
  const startFound = zoomStart === 'dataMin' ? -1 : data.findIndex((s) => s[xKey] === zoomStart)
  const endFound = zoomEnd === 'dataMax' ? -1 : data.findIndex((s) => s[xKey] === zoomEnd)
  const brushStartIndex = startFound === -1 ? 0 : startFound
  const brushEndIndex = endFound === -1 ? lastIndex : endFound

  const statEntries = STAT_ORDER.filter((kind) => enabledStats.includes(kind) && stats[kind] != null).map(
    (kind) => ({ kind, value: stats[kind] }),
  )

  return (
    <div className="metric-panel" style={{ minHeight: height }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId={SYNC_ID} margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis type="number" dataKey={xKey} domain={zoomDomain} hide={!showXAxis} interval={0} />
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
          {showBrush && (
            <Brush
              dataKey={xKey}
              height={BRUSH_HEIGHT}
              stroke="var(--stat-line)"
              travellerWidth={8}
              startIndex={brushStartIndex}
              endIndex={brushEndIndex}
              onChange={({ startIndex, endIndex }) => {
                onZoomChange?.([data[startIndex][xKey], data[endIndex][xKey]])
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <StatSummary metric={metric} entries={statEntries} sport={activity.sport} />
    </div>
  )
}
