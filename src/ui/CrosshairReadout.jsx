// The crosshair's readout — fixed at each panel's upper left, never following
// the cursor. See ARCHITECTURE.md §7.
//
// THIS IS A BRIDGE, NOT A TOOLTIP. It is still passed as `<Tooltip content>`,
// because the hover state it reads lives in each <LineChart>'s own private
// Recharts store, and that store — plus syncId and the synthesized mouseout in
// useTouchHoverHandoff.js — is what makes one crosshair drive every panel and
// behave on touch. Rather than render a box where Recharts positions it, it
// `createPortal`s the formatted value into a slot node in the panel's head,
// which sits above the chart and outside the SVG.
//
// Three facts from recharts@3.10.1 make that safe, and all three are the kind
// that would be expensive to rediscover:
//
//  1. `component/Tooltip.js` ends in `renderContent(content, tooltipContentProps)`
//     where the props always carry `active: finalIsActive` — the content element
//     is rendered whether or not the tooltip is active, so this component is
//     mounted at rest and simply portals nothing (it returns null on !active,
//     and Recharts blanks the payload there anyway).
//  2. `component/TooltipBoundingBox.js` always renders its wrapper <div> and its
//     children, toggling only `visibility: hidden/visible`. It never unmounts,
//     so the bridge is never torn down mid-hover. Its `visibility` and
//     `pointerEvents: none` do not reach the portaled nodes: CSS inherits down
//     the DOM tree, and the portal's content lives in the panel head.
//  3. `state/selectors/tooltipSelectors.js` merges a panel's own hover with the
//     incoming `syncInteraction` (`combineTooltipInteractionState`), which is
//     why a panel nobody is hovering still receives a payload and can fill its
//     own label from the panel next door.
//
// REJECTED, and please don't "simplify" into either: writing the hovered index
// to ChartViewContext (a context write per hover frame re-renders ChartStack and
// therefore every <LineChart> under it — today only this subtree re-renders per
// mouse move), and `<Tooltip position={{x, y}}>` (it pins the box inside
// `.recharts-wrapper`, so it cannot reach a row that sits above the chart).
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatDistanceKm, formatDuration } from '../domain/units.js'
import { metricUnit } from '../metrics/metricRegistry.js'
import { publishCrosshair } from './crosshairBus.js'

/**
 * Announces the hovered position on ui/crosshairBus.js, for the map panel's
 * marker canvas. Renders nothing.
 *
 * **A CHILD COMPONENT, NOT A HOOK IN CrosshairReadout ITSELF.** That function's
 * `if (!active || !payload …) return null` is its first statement and there are
 * no hooks below it; adding one would be a hook-order violation the moment the
 * tooltip goes inactive. Mounting this only while active turns that early
 * return into exactly the signal the map needs — unmount is "clear the marker",
 * handled by the effect's own cleanup, with no second code path to keep in sync.
 *
 * An effect rather than publishing during render, so it is StrictMode-safe: a
 * double-invoked render would publish twice with nothing to undo it, while a
 * double-invoked effect runs publish → cleanup → publish and ends in the
 * correct state.
 */
function HoverPublisher({ t, d }) {
  useEffect(() => {
    publishCrosshair({ t, d })
    return () => publishCrosshair(null)
  }, [t, d])
  return null
}

/**
 * @param {object} props
 * @param {object} props.metric - the registry entry this panel draws
 * @param {string} [props.sport]
 * @param {{key: string, spec: {label: string, unit: string, format: (v: number) => string}}|null} [props.derivative]
 *   - the overlay's row key and display spec while one is switched on
 * @param {Element|null} [props.valueSlot] - this panel's own head slot
 * @param {Element|null} [props.positionSlot] - the app header's shared time/distance
 *   slot. Passed to the FIRST visible panel only: every panel is synced to the
 *   same sample, so one of them reports the position and the rest pass null.
 * @param {boolean} [props.primary] - whether this is that first visible panel.
 *   An EXPLICIT prop rather than inferring it from `positionSlot != null`, even
 *   though ChartStack derives both from the same `i === 0`: dozens of tests
 *   render a panel with a null slot, and the map's marker must still be driven
 *   in those. One panel publishes because every panel is synced to the same
 *   sample and N publishers would be N redundant writes per hover frame.
 */
export function CrosshairReadout({ active, payload, metric, sport, derivative, valueSlot, positionSlot, primary }) {
  if (!active || !payload || payload.length === 0) return null

  // Selected BY dataKey, never by position. A panel with a derivative overlay
  // puts two <Line>s in the payload and Recharts does not specify their order,
  // so the old `payload[0]` would have shown the rate under the metric's own
  // unit roughly half the time.
  const metricEntry = payload.find((entry) => entry.dataKey === metric.id)
  const derivEntry = derivative == null ? undefined : payload.find((entry) => entry.dataKey === derivative.key)

  // The x/y position comes off whichever entry is present: both carry the same
  // row, and a hover can legitimately land where only one of them has a value.
  const point = (metricEntry ?? derivEntry ?? payload[0]).payload
  const value = metricEntry?.value

  return (
    <>
      {/* The metric's NAME is not in here — it is static text in the head, right
          next to this slot, so the readout is value + unit only. That is the one
          behavioural difference from the floating tooltip this replaced. */}
      {valueSlot != null &&
        createPortal(
          <>
            <span className="crosshair-value">
              {value == null ? '–' : metric.format(value)} {metricUnit(metric, sport)}
            </span>
            {derivEntry !== undefined && (
              <span className="crosshair-deriv">
                {derivative.spec.label} {derivEntry.value == null ? '–' : derivative.spec.format(derivEntry.value)}{' '}
                {derivative.spec.unit}
              </span>
            )}
          </>,
          valueSlot,
        )}
      {/* Both elapsed time and distance, whichever the x-axis is showing —
          users think in both (ARCHITECTURE.md §7). */}
      {positionSlot != null &&
        createPortal(
          <>
            {formatDuration(point.t)} · {formatDistanceKm(point.d)}
          </>,
          positionSlot,
        )}
      {/* Same "first visible panel only" rule as the position slot above, and
          the same reason. Rendered last so its effect runs after the portals
          have committed — irrelevant to correctness, but it keeps the reading
          order of this component matching the order things reach the screen. */}
      {primary && <HoverPublisher t={point.t} d={point.d} />}
    </>
  )
}
