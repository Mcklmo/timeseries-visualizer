// Switches the shared x-axis between elapsed time and cumulative distance.
// See ARCHITECTURE.md §10 — writes ChartViewContext's xMode, which every
// MetricPanel reads to pick its XAxis dataKey.
import { useChartView } from '../state/ChartViewContext.jsx'

const MODES = [
  { id: 'time', label: 'Time' },
  { id: 'distance', label: 'Distance' },
]

export function XAxisModeSwitch() {
  const { xMode, setXMode } = useChartView()

  return (
    <div className="x-axis-mode-switch" role="group" aria-label="X-axis mode">
      {MODES.map(({ id, label }) => (
        <button key={id} type="button" aria-pressed={xMode === id} onClick={() => setXMode(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}
