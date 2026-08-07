// One stacked chart panel for a single metric. See ARCHITECTURE.md §7.
// Every panel shares syncId, XAxis dataKey/domain, and YAxis width with its
// siblings in ChartStack so plot areas align pixel-for-pixel and the
// tooltip/crosshair stays in sync across the whole stack.
import { useMemo } from 'react'
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useYAxisScale,
  XAxis,
  YAxis,
} from 'recharts'
import { metricRegistry, metricUnit } from '../metrics/metricRegistry.js'
import { computeYDomain } from '../stats/aggregate.js'
import { useMetricStats } from '../stats/useMetricStats.js'
import { SyncedTooltip } from './SyncedTooltip.jsx'

const SYNC_ID = 'activity'
const Y_AXIS_WIDTH = 56 // matches --y-axis-width token; fixed so panels align

const STAT_ORDER = ['max', 'avg', 'median']
const STAT_DASH = { max: '4 4', avg: undefined, median: '2 3' }
const BRUSH_HEIGHT = 24
const STAT_LABEL_GAP = 8 // px between the plot area and the label text
const MIN_STAT_LABEL_SPACING = 16 // px, so nearby stat values don't overlap

// Reference lines can land pixels apart (e.g. avg ~= median), which crowds
// their labels together. Nudge each label's y away from its neighbors,
// keeping the sorted order, so every stat stays legible.
function declutter(positions) {
  const sorted = [...positions].sort((a, b) => a.y - b.y)
  for (let i = 1; i < sorted.length; i++) {
    sorted[i] = { ...sorted[i], y: Math.max(sorted[i].y, sorted[i - 1].y + MIN_STAT_LABEL_SPACING) }
  }
  for (let i = sorted.length - 2; i >= 0; i--) {
    sorted[i] = { ...sorted[i], y: Math.min(sorted[i].y, sorted[i + 1].y - MIN_STAT_LABEL_SPACING) }
  }
  return sorted
}

// Labels for all enabled stats of one metric, positioned from the real
// y-scale and decluttered together — a per-ReferenceLine `label` prop can't
// coordinate with its siblings, so this renders them as one overlay instead.
function StatLabels({ metric, entries, sport }) {
  const yScale = useYAxisScale()
  const plotArea = usePlotArea()
  if (!yScale || !plotArea || entries.length === 0) return null

  const x = plotArea.x + plotArea.width + STAT_LABEL_GAP
  const positioned = declutter(entries.map(({ kind, value }) => ({ kind, value, y: yScale(value) })))
  const unit = metricUnit(metric, sport)

  return (
    <g className="stat-labels">
      {positioned.map(({ kind, value, y }) => (
        <text key={kind} x={x} y={y} dominantBaseline="central" fill="var(--stat-line)" fontFamily="var(--font-data)">
          {kind.toUpperCase()} {metric.format(value)} {unit}
        </text>
      ))}
    </g>
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
    <div className="metric-panel" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId={SYNC_ID} margin={{ top: 8, right: 200, bottom: 16, left: 4 }}>
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
          <StatLabels metric={metric} entries={statEntries} sport={activity.sport} />
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
    </div>
  )
}
