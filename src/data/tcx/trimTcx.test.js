import { describe, it, expect } from 'vitest'
import { parseTcx } from './parseTcx.js'
import { trimTcx } from './trimTcx.js'

const TCX_NS = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'
const T0 = new Date('2026-01-01T06:00:00.000Z')

const at = (s) => new Date(T0.getTime() + s * 1000).toISOString()

const window = (fromS, toS) => ({
  from: new Date(T0.getTime() + fromS * 1000),
  to: new Date(T0.getTime() + toS * 1000),
})

/**
 * Distance is cumulative from the ACTIVITY's start and runs across lap
 * boundaries, exactly as Garmin writes it — which is the whole reason the
 * rebase exists.
 */
function trackpoint(s, { hr = true, speed = true, distance = true } = {}) {
  return `          <Trackpoint>
            <Time>${at(s)}</Time>
            <Position>
              <LatitudeDegrees>57.01</LatitudeDegrees>
              <LongitudeDegrees>9.97</LongitudeDegrees>
            </Position>
            <AltitudeMeters>12.6</AltitudeMeters>${distance ? `\n            <DistanceMeters>${s * 3}</DistanceMeters>` : ''}${hr ? `\n            <HeartRateBpm>\n              <Value>${140 + (s % 10)}</Value>\n            </HeartRateBpm>` : ''}${speed ? `\n            <Extensions>\n              <ns3:TPX>\n                <ns3:Speed>${(3 + (s % 5) / 10).toFixed(3)}</ns3:Speed>\n                <ns3:RunCadence>80</ns3:RunCadence>\n              </ns3:TPX>\n            </Extensions>` : ''}
          </Trackpoint>`
}

function lap(offsets, options = {}) {
  return `      <Lap StartTime="${at(offsets[0])}">
        <TotalTimeSeconds>999</TotalTimeSeconds>
        <DistanceMeters>9999</DistanceMeters>
        <MaximumSpeed>9.9</MaximumSpeed>
        <Calories>361</Calories>${options.hr === false ? '' : `\n        <AverageHeartRateBpm>\n          <Value>141</Value>\n        </AverageHeartRateBpm>\n        <MaximumHeartRateBpm>\n          <Value>159</Value>\n        </MaximumHeartRateBpm>`}
        <Intensity>Active</Intensity>
        <TriggerMethod>Distance</TriggerMethod>
        <Track>
${offsets.map((s) => trackpoint(s, options)).join('\n')}
        </Track>${options.extensions ?? ''}
      </Lap>`
}

function tcxDoc({ laps = [[0, 1, 2, 3, 4, 5, 6]], options = {}, activities = null } = {}) {
  const body =
    activities ??
    `    <Activity Sport="Running">
      <Id>${at(0)}</Id>
${laps.map((offsets) => lap(offsets, options)).join('\n')}
      <Creator xsi:type="Device_t">
        <Name>Forerunner 265</Name>
      </Creator>
    </Activity>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xmlns="${TCX_NS}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Activities>
${body}
  </Activities>
</TrainingCenterDatabase>`
}

const parse = (text) => new DOMParser().parseFromString(text, 'application/xml')
const lapsOf = (text) => Array.from(parse(text).getElementsByTagNameNS(TCX_NS, 'Lap'))
const childNames = (el) => Array.from(el.children).map((child) => child.localName)
const textOf = (el, name) => el.getElementsByTagNameNS(TCX_NS, name)[0]?.textContent?.trim() ?? null

describe('trimTcx', () => {
  it('keeps the trackpoints inside the window and drops the rest, both ends inclusive', () => {
    const out = trimTcx(tcxDoc(), window(2, 5))

    const times = parseTcx(out).trackpoints.map((tp) => tp.time.toISOString())
    // 4 points, not 3: seconds 2 and 5 are both boundary seconds and both stay.
    expect(times).toEqual([at(2), at(3), at(4), at(5)])
  })

  it('re-bases DistanceMeters so the first kept trackpoint reads 0', () => {
    const out = trimTcx(tcxDoc(), window(2, 5))

    const distances = parseTcx(out).trackpoints.map((tp) => tp.distanceMeters)
    // Un-rebased these would open at 6 m and the window would read 15 m long.
    expect(distances).toEqual([0, 3, 6, 9])
  })

  it('starts the output with the XML declaration XMLSerializer drops', () => {
    expect(trimTcx(tcxDoc(), window(2, 5)).startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('recomputes the lap summary from the trackpoints the window left', () => {
    const out = trimTcx(tcxDoc(), window(2, 5))
    const [lapEl] = lapsOf(out)

    expect(textOf(lapEl, 'TotalTimeSeconds')).toBe('3')
    // A difference within the lap, so it is the same before and after the rebase.
    expect(textOf(lapEl, 'DistanceMeters')).toBe('9')
    // seconds 2..5 -> 142, 143, 144, 145; the mean is rounded, not truncated.
    expect(textOf(lapEl, 'AverageHeartRateBpm')).toBe('144')
    expect(textOf(lapEl, 'MaximumHeartRateBpm')).toBe('145')
    // max of 3.2, 3.3, 3.4, 3.0
    expect(textOf(lapEl, 'MaximumSpeed')).toBe('3.4')
  })

  it('re-cuts Lap@StartTime and <Id> to the first kept trackpoint', () => {
    const out = trimTcx(tcxDoc(), window(2, 5))

    expect(lapsOf(out)[0].getAttribute('StartTime')).toBe(at(2))
    // Garmin Connect dedupes uploads on <Id>; the parent's value would make the
    // trimmed file claim to BE its parent.
    expect(parse(out).getElementsByTagNameNS(TCX_NS, 'Id')[0].textContent).toBe(at(2))
  })

  it("keeps <Lap>'s children in the schema's xsd:sequence order", () => {
    // The assertion that protects upload validity, and the only one that would
    // notice an element being appended instead of placed. ActivityLap_t is an
    // xsd:sequence — order is not cosmetic.
    const out = trimTcx(tcxDoc(), window(2, 5))

    expect(childNames(lapsOf(out)[0])).toEqual([
      'TotalTimeSeconds',
      'DistanceMeters',
      'MaximumSpeed',
      'Calories',
      'AverageHeartRateBpm',
      'MaximumHeartRateBpm',
      'Intensity',
      'TriggerMethod',
      'Track',
    ])
  })

  it('places an inserted element at its schema position rather than at the end', () => {
    // A lap written without the required <Calories>: the insert has to land
    // between MaximumSpeed and AverageHeartRateBpm, not after <Track>.
    const out = trimTcx(tcxDoc().replace('<Calories>361</Calories>\n', ''), window(2, 5))
    const names = childNames(lapsOf(out)[0])

    expect(names.indexOf('Calories')).toBe(names.indexOf('MaximumSpeed') + 1)
    expect(names.indexOf('Calories')).toBeLessThan(names.indexOf('Track'))
  })

  it('writes <Calories>0</Calories> rather than carrying or prorating the parent figure', () => {
    const out = trimTcx(tcxDoc(), window(2, 5))
    // The schema forces the element to exist, so trimFit's omit-rather-than-
    // prorate rule is unavailable; 0 is the format's conventional "not measured".
    expect(textOf(lapsOf(out)[0], 'Calories')).toBe('0')
  })

  it('marks a re-cut lap TriggerMethod Manual — the device did not choose these edges', () => {
    const out = trimTcx(tcxDoc(), window(2, 5))
    expect(textOf(lapsOf(out)[0], 'TriggerMethod')).toBe('Manual')
  })

  it('leaves a lap with no heart rate WITHOUT the element, rather than 0 or NaN', () => {
    const out = trimTcx(tcxDoc({ options: { hr: false } }), window(2, 5))
    const [lapEl] = lapsOf(out)

    expect(childNames(lapEl)).not.toContain('AverageHeartRateBpm')
    expect(childNames(lapEl)).not.toContain('MaximumHeartRateBpm')
    expect(out).not.toContain('NaN')
  })

  it('removes a MaximumSpeed the window has no speed channel for', () => {
    const out = trimTcx(tcxDoc({ options: { speed: false } }), window(2, 5))
    expect(childNames(lapsOf(out)[0])).not.toContain('MaximumSpeed')
  })

  it('drops a lap the window emptied, and its <Track> with it', () => {
    const out = trimTcx(tcxDoc({ laps: [[0, 1, 2, 3], [50, 51, 52, 53]] }), window(1, 3))

    expect(lapsOf(out)).toHaveLength(1)
    expect(parse(out).getElementsByTagNameNS(TCX_NS, 'Trackpoint')).toHaveLength(3)
  })

  it('refuses a window that empties every lap', () => {
    expect(() => trimTcx(tcxDoc({ laps: [[0, 1, 2], [50, 51, 52]] }), window(20, 30))).toThrow(
      "That zoom window doesn't contain enough of this file to export",
    )
  })

  it('refuses a window holding fewer than two trackpoints', () => {
    expect(() => trimTcx(tcxDoc(), window(2, 2))).toThrow(
      "That zoom window doesn't contain enough of this file to export",
    )
  })

  it('passes <Creator> through verbatim — who recorded this is still true of a window', () => {
    const out = trimTcx(tcxDoc(), window(2, 5))
    expect(out).toContain('<Name>Forerunner 265</Name>')
  })

  it('overwrites the ns3:LX values it can derive and removes the ones it cannot', () => {
    const extensions = `
        <Extensions>
          <ns3:LX>
            <ns3:AvgRunCadence>80</ns3:AvgRunCadence>
            <ns3:Steps>2900</ns3:Steps>
          </ns3:LX>
        </Extensions>`
    const out = trimTcx(tcxDoc({ options: { extensions } }), window(2, 5))

    expect(out).toContain('<ns3:AvgRunCadence>80</ns3:AvgRunCadence>')
    // No trackpoint field adds up to a step count, so it goes rather than
    // describing the parent activity inside a trimmed lap.
    expect(out).not.toContain('Steps')
  })

  it('exports only the first <Activity> of a multi-activity file — the one on screen', () => {
    const doc = tcxDoc().replace(
      '  </Activities>',
      `    <Activity Sport="Biking">\n      <Id>${at(900)}</Id>\n${lap([900, 901, 902])}\n    </Activity>\n  </Activities>`,
    )
    const out = trimTcx(doc, window(2, 5))

    expect(parse(out).getElementsByTagNameNS(TCX_NS, 'Activity')).toHaveLength(1)
    expect(out).not.toContain('Sport="Biking"')
  })

  it('rejects a document holding no Activity at all', () => {
    expect(() => trimTcx('<gpx xmlns="http://www.topografix.com/GPX/1/1"/>', window(0, 10))).toThrow(
      /is it a TCX export/,
    )
  })
})
