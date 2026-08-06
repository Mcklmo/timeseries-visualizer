// One stacked chart panel for a single metric. See ARCHITECTURE.md §7.
// Every panel shares syncId, XAxis dataKey/domain, and YAxis width with its
// siblings in ChartStack so plot areas align pixel-for-pixel and the
// tooltip/crosshair stays in sync across the whole stack.
import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { metricRegistry } from '../metrics/metricRegistry.js'
import { useMetricStats } from '../stats/useMetricStats.js'
import { SyncedTooltip } from './SyncedTooltip.jsx'

const SYNC_ID = 'activity'
const Y_AXIS_WIDTH = 56 // matches --y-axis-width token; fixed so panels align

const STAT_ORDER = ['max', 'avg', 'median']
const STAT_DASH = { max: '4 4', avg: undefined, median: '2 3' }

export function MetricPanel({ activity, metricId, xMode, zoomDomain, enabledStats, showXAxis, height }) {
  const metric = metricRegistry[metricId]
  const stats = useMetricStats(activity, metricId)
  const xKey = xMode === 'distance' ? 'd' : 't'

  const data = useMemo(
    () => activity.samples.map((s) => ({ t: s.t, d: s.d, [metricId]: metric.accessor(s) })),
    [activity.samples, metricId, metric],
  )

  return (
    <div className="metric-panel" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId={SYNC_ID} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis type="number" dataKey={xKey} domain={zoomDomain} hide={!showXAxis} interval={0} />
          <YAxis width={Y_AXIS_WIDTH} reversed={!!metric.invertAxis} tickFormatter={metric.format} interval={0} />
          <Tooltip content={<SyncedTooltip metric={metric} />} cursor={{ stroke: 'var(--stat-line)' }} isAnimationActive={false} />
          {STAT_ORDER.filter((kind) => enabledStats.includes(kind) && stats[kind] != null).map((kind) => (
            <ReferenceLine
              key={kind}
              y={stats[kind]}
              stroke="var(--stat-line)"
              strokeDasharray={STAT_DASH[kind]}
              label={{
                value: `${metric.label} ${metric.format(stats[kind])} ${metric.unit}`,
                position: 'right',
                fill: 'var(--stat-line)',
              }}
            />
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
    </div>
  )
}
