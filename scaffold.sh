#!/usr/bin/env bash
# Creates the folder scaffold from ARCHITECTURE.md.
# Run from the root of your Vite project. Idempotent: never overwrites existing files.

set -euo pipefail

if [ ! -f package.json ]; then
  echo "No package.json here. Run this from your Vite project root." >&2
  exit 1
fi

dirs=(
  src/app
  src/data/tcx
  src/data/http
  src/data/mock
  src/domain
  src/stats
  src/metrics
  src/state
  src/ui
  src/styles
  fixtures
)

files=(
  src/app/providers.jsx
  src/data/ActivitySource.js
  src/data/tcx/TcxActivitySource.js
  src/data/tcx/parseTcx.js
  src/data/http/HttpActivitySource.js
  src/data/mock/MockActivitySource.js
  src/domain/types.js
  src/domain/normalizeActivity.js
  src/domain/deriveSpeed.js
  src/domain/buildDistanceAxis.js
  src/domain/detectPauses.js
  src/domain/smooth.js
  src/domain/downsample.js
  src/domain/units.js
  src/stats/aggregate.js
  src/stats/useMetricStats.js
  src/metrics/metricRegistry.js
  src/state/ActivityContext.jsx
  src/state/ChartViewContext.jsx
  src/ui/ChartStack.jsx
  src/ui/MetricPanel.jsx
  src/ui/ControlPanel.jsx
  src/ui/MetricToggle.jsx
  src/ui/StatCheckboxes.jsx
  src/ui/XAxisModeSwitch.jsx
  src/ui/FileDropZone.jsx
  src/ui/SyncedTooltip.jsx
  src/ui/EmptyState.jsx
  src/ui/ErrorState.jsx
  src/styles/tokens.css
  src/styles/global.css
)

for d in "${dirs[@]}"; do mkdir -p "$d"; done

for f in "${files[@]}"; do
  if [ -e "$f" ]; then
    echo "skip   $f"
  else
    printf '// TODO: see ARCHITECTURE.md\n' > "$f"
    echo "create $f"
  fi
done

echo
echo "Next: npm i recharts"
echo "Then build in the order given in ARCHITECTURE.md section 11."
