import { describe, expect, it } from 'vitest'
import { toBase64Url } from '../../lib/base64url.js'
import {
  MISSING_PAYLOAD,
  SHARE_HASH_PREFIX,
  SHARE_MESSAGES,
  clearSharedHash,
  decodePayload,
  encodeActivityToPayload,
  readSharedPayloadFromHash,
} from './shareCodec.js'

// ---------------------------------------------------------------------------
// Test-side wire-format builders. Deliberately reimplemented rather than
// imported: these pin the byte format itself, so a codec refactor that
// changes the wire shape fails here instead of round-tripping invisibly.

function pushUvarint(out, value) {
  let v = value
  for (;;) {
    if (v < 0x80) {
      out.push(v)
      return
    }
    out.push((v % 0x80) + 0x80)
    v = Math.floor(v / 0x80)
  }
}

const zigzag = (n) => (n >= 0 ? n * 2 : -n * 2 - 1)

async function gzip(bytes) {
  const zipped = await new Response(
    new Response(Uint8Array.from(bytes)).body.pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  return new Uint8Array(zipped)
}

async function payloadFromBody(bodyBytes) {
  return `1${toBase64Url(await gzip(bodyBytes))}`
}

/**
 * A minimal valid v1 body: running, epoch 1,000,000s, no name, no optional
 * columns, two samples one second and ten metres apart. Mutate from here.
 */
function minimalBody({ sport = 0, mask = 0, count = 2, name = [] } = {}) {
  const out = [sport]
  pushUvarint(out, 1000000)
  pushUvarint(out, name.length)
  out.push(...name)
  out.push(mask)
  pushUvarint(out, count)
  for (let i = 0; i < count; i += 1) pushUvarint(out, 10) // t deltas, 1s each
  for (let i = 0; i < count; i += 1) pushUvarint(out, 100) // d deltas, 10m each
  return out
}

/** A synthetic in-memory Activity shaped like normalizeActivity's output. */
function syntheticActivity({ count = 100, withTrack = true, withMetrics = true } = {}) {
  const samples = []
  for (let i = 0; i < count; i += 1) {
    const sample = { t: i, d: i * 3.2, moving: true }
    if (withMetrics) {
      sample.speed = 3 + Math.sin(i / 10) * 0.5
      sample.heartRate = 140 + (i % 20)
      sample.cadence = 170 + (i % 6)
      sample.power = 250 + (i % 30)
      sample.altitude = 40 + Math.sin(i / 25) * 10
    }
    samples.push(sample)
  }
  let track = null
  if (withTrack) {
    const x = new Float64Array(count)
    const y = new Float64Array(count)
    for (let i = 0; i < count; i += 1) {
      // A slow drift around Copenhagen; slot 7 loses its fix.
      if (i === 7) {
        x[i] = NaN
        y[i] = NaN
        continue
      }
      x[i] = 0.5349 + i * 1e-6
      y[i] = 0.313 - i * 1e-6
    }
    track = { x, y, bounds: { x0: 0, y0: 0, x1: 1, y1: 1 }, fixCount: count - 1 }
  }
  return {
    id: 'synthetic',
    sport: 'running',
    name: 'Synthetic Run',
    startTime: new Date('2026-08-01T07:00:00Z'),
    totalTime: count - 1,
    totalMovingTime: count - 1,
    totalDistance: (count - 1) * 3.2,
    samples,
    samplingIntervalS: 1,
    availableMetrics: withMetrics ? ['pace', 'speed', 'heartRate', 'power', 'cadence', 'altitude'] : [],
    track,
  }
}

describe('encode -> decode round trip', () => {
  it('reconstructs every column on the quantization grid', async () => {
    const activity = syntheticActivity({ count: 50 })
    const decoded = await decodePayload(await encodeActivityToPayload(activity))

    expect(decoded.sport).toBe('running')
    expect(decoded.name).toBe('Synthetic Run')
    expect(decoded.trackpoints).toHaveLength(50)

    for (let i = 0; i < 50; i += 1) {
      const tp = decoded.trackpoints[i]
      const sample = activity.samples[i]
      expect(tp.time.getTime()).toBe(activity.startTime.getTime() + sample.t * 1000)
      expect(tp.distanceMeters).toBeCloseTo(sample.d, 1)
      expect(tp.heartRateBpm).toBe(sample.heartRate)
      expect(tp.cadenceSpm).toBe(sample.cadence)
      expect(tp.watts).toBe(sample.power)
      expect(Math.abs(tp.altitudeMeters - sample.altitude)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(tp.speedMps - sample.speed)).toBeLessThanOrEqual(0.005)
    }
  })

  it('keeps the no-fix gap a gap', async () => {
    const decoded = await decodePayload(await encodeActivityToPayload(syntheticActivity()))
    expect(decoded.trackpoints[7].lat).toBeUndefined()
    expect(decoded.trackpoints[7].lon).toBeUndefined()
    expect(decoded.trackpoints[6].lat).toBeDefined()
    expect(decoded.trackpoints[8].lat).toBeDefined()
  })

  it('positions survive within the 1e-5 degree grid', async () => {
    const decoded = await decodePayload(await encodeActivityToPayload(syntheticActivity({ count: 10 })))
    // Slot 0 projects back from x=0.5349, y=0.313 — lat/lon of that point.
    expect(decoded.trackpoints[0].lon).toBeCloseTo(0.5349 * 360 - 180, 4)
    expect(decoded.trackpoints[0].lat).toBeGreaterThan(55)
    expect(decoded.trackpoints[0].lat).toBeLessThan(56)
  })

  it('omits columns the activity has no data for', async () => {
    const decoded = await decodePayload(
      await encodeActivityToPayload(syntheticActivity({ withTrack: false, withMetrics: false })),
    )
    const tp = decoded.trackpoints[0]
    expect(tp.lat).toBeUndefined()
    expect(tp.heartRateBpm).toBeUndefined()
    expect(tp.watts).toBeUndefined()
    expect(tp.speedMps).toBeUndefined()
    expect(tp.altitudeMeters).toBeUndefined()
    expect(tp.distanceMeters).toBeDefined()
  })

  it('treats non-finite and out-of-range metric values as absent, not fatal', async () => {
    const activity = syntheticActivity({ count: 10, withTrack: false })
    activity.samples[3].heartRate = NaN
    activity.samples[4].heartRate = Infinity
    activity.samples[5].heartRate = 900 // beyond any human heart
    const decoded = await decodePayload(await encodeActivityToPayload(activity))
    expect(decoded.trackpoints[3].heartRateBpm).toBeUndefined()
    expect(decoded.trackpoints[4].heartRateBpm).toBeUndefined()
    expect(decoded.trackpoints[5].heartRateBpm).toBeUndefined()
    expect(decoded.trackpoints[6].heartRateBpm).toBe(146)
  })

  it('does not accumulate quantization drift over a long activity', async () => {
    // 10k samples of a value that lands between grid points every step —
    // the case naive delta-of-rounded-deltas drifts on.
    const count = 10000
    const activity = syntheticActivity({ count: 2, withTrack: false, withMetrics: false })
    activity.samples = []
    for (let i = 0; i < count; i += 1) {
      activity.samples.push({ t: i, d: i * 1.234567, altitude: 100 + i * 0.0503, moving: true })
    }
    const decoded = await decodePayload(await encodeActivityToPayload(activity, { maxChars: 128000 }))
    const last = decoded.trackpoints[count - 1]
    expect(Math.abs(last.distanceMeters - (count - 1) * 1.234567)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(last.altitudeMeters - (100 + (count - 1) * 0.0503))).toBeLessThanOrEqual(0.05)
  })

  it('caps the shared name at 120 characters', async () => {
    const activity = syntheticActivity({ count: 5 })
    activity.name = 'x'.repeat(400)
    const decoded = await decodePayload(await encodeActivityToPayload(activity))
    expect(decoded.name).toHaveLength(120)
  })
})

describe('the byte budget', () => {
  it('stride-decimates to fit, keeping the first and last samples', async () => {
    const activity = syntheticActivity({ count: 2000 })
    // Sine-wave metrics gzip too well to force decimation — jitter them with
    // a deterministic LCG so the payload carries real entropy, like a sensor.
    let seed = 42
    const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (const sample of activity.samples) {
      sample.heartRate = 100 + Math.floor(noise() * 80)
      sample.power = 150 + Math.floor(noise() * 200)
      sample.speed = 2 + noise() * 3
      sample.altitude = 40 + noise() * 100
    }
    const payload = await encodeActivityToPayload(activity, { maxChars: 2000 })
    expect(payload.length).toBeLessThanOrEqual(2000)

    const decoded = await decodePayload(payload)
    expect(decoded.trackpoints.length).toBeLessThan(2000)
    expect(decoded.trackpoints.length).toBeGreaterThan(2)
    const last = decoded.trackpoints[decoded.trackpoints.length - 1]
    // The last original sample survives decimation — totals depend on it.
    expect(last.time.getTime() - decoded.trackpoints[0].time.getTime()).toBe(1999 * 1000)
    expect(last.distanceMeters).toBeCloseTo(1999 * 3.2, 1)
  })

  it('leaves an already-small activity at full resolution', async () => {
    const decoded = await decodePayload(await encodeActivityToPayload(syntheticActivity({ count: 300 })))
    expect(decoded.trackpoints).toHaveLength(300)
  })

  it('refuses an activity with fewer than two samples', async () => {
    await expect(encodeActivityToPayload(syntheticActivity({ count: 0 }))).rejects.toThrow(
      SHARE_MESSAGES.tooSmall,
    )
    await expect(encodeActivityToPayload(syntheticActivity({ count: 1 }))).rejects.toThrow(
      SHARE_MESSAGES.tooSmall,
    )
  })
})

describe('decode rejects hostile payloads', () => {
  it('with the missing copy for the KV-miss sentinel', async () => {
    await expect(decodePayload(MISSING_PAYLOAD)).rejects.toThrow(SHARE_MESSAGES.missing)
  })

  it('with the newer-version copy for a higher version digit', async () => {
    await expect(decodePayload('2AbCdEf')).rejects.toThrow(SHARE_MESSAGES.newer)
  })

  it.each([
    ['not a string', null],
    ['empty', ''],
    ['one char', '1'],
    ['a non-digit version char', 'zAbCd'],
    ['a character outside base64url', '1AbC+d'],
    ['whitespace atob would accept', '1AbC d'],
    ['not gzip after base64', `1${'A'.repeat(64)}`],
    ['longer than the pre-work cap', `1${'A'.repeat(130000)}`],
  ])('with the damaged copy for %s', async (_label, payload) => {
    await expect(decodePayload(payload)).rejects.toThrow(SHARE_MESSAGES.damaged)
  })

  it('rejects a truncated but otherwise real payload', async () => {
    const payload = await encodeActivityToPayload(syntheticActivity({ count: 40 }))
    await expect(decodePayload(payload.slice(0, payload.length - 6))).rejects.toThrow(
      SHARE_MESSAGES.damaged,
    )
  })

  it.each([
    ['an unknown sport', () => minimalBody({ sport: 3 })],
    ['an unknown column bit', () => minimalBody({ mask: 0b1000000 })],
    [
      'a sample count of zero',
      () => {
        const out = [0]
        pushUvarint(out, 1000000)
        pushUvarint(out, 0)
        out.push(0)
        pushUvarint(out, 0)
        return out
      },
    ],
    [
      'an absurd sample count',
      () => {
        const out = [0]
        pushUvarint(out, 1000000)
        pushUvarint(out, 0)
        out.push(0)
        pushUvarint(out, 1e9)
        return out
      },
    ],
    [
      'a name longer than the cap',
      () => {
        const out = [0]
        pushUvarint(out, 1000000)
        pushUvarint(out, 600)
        for (let i = 0; i < 600; i += 1) out.push(65)
        out.push(0)
        pushUvarint(out, 2)
        for (let i = 0; i < 4; i += 1) pushUvarint(out, 10)
        return out
      },
    ],
    [
      'a start time far in the future',
      () => {
        const out = [0]
        pushUvarint(out, Math.floor(Date.now() / 1000) + 20 * 366 * 24 * 3600)
        pushUvarint(out, 0)
        out.push(0)
        pushUvarint(out, 2)
        for (let i = 0; i < 4; i += 1) pushUvarint(out, 10)
        return out
      },
    ],
    ['trailing bytes after the last column', () => [...minimalBody(), 0]],
    ['a body truncated mid-column', () => minimalBody().slice(0, -1)],
    [
      'a latitude beyond the pole',
      () => {
        const out = minimalBody({ mask: 0b1 })
        out.push(0b11) // both samples claim a fix
        pushUvarint(out, zigzag(91 * 1e5)) // lat 91°
        pushUvarint(out, zigzag(0))
        pushUvarint(out, zigzag(0))
        pushUvarint(out, zigzag(0))
        return out
      },
    ],
    [
      'a heart rate no human has',
      () => {
        const out = minimalBody({ mask: 0b100 })
        out.push(0b11)
        pushUvarint(out, zigzag(301))
        pushUvarint(out, zigzag(0))
        return out
      },
    ],
    [
      'an overlong varint',
      () => {
        const out = [0]
        // Six continuation bytes encodes past 2^35 — MAX_VARINT_BYTES stops it.
        out.push(0x80, 0x80, 0x80, 0x80, 0x80, 0x01)
        return out
      },
    ],
  ])('rejects a well-compressed body carrying %s', async (_label, buildBody) => {
    await expect(decodePayload(await payloadFromBody(buildBody()))).rejects.toThrow(
      SHARE_MESSAGES.damaged,
    )
  })

  it('aborts a gzip bomb at the inflate cap instead of buffering it', async () => {
    // ~8 MB of zeros gzips to a few KB; the capped reader must refuse at 4 MB.
    const bomb = await gzip(new Array(8 * 1024 * 1024).fill(0))
    await expect(decodePayload(`1${toBase64Url(bomb)}`)).rejects.toThrow(SHARE_MESSAGES.damaged)
  })

  it('accepts the minimal valid body — the mutants above fail for their mutation, not the base', async () => {
    const decoded = await decodePayload(await payloadFromBody(minimalBody()))
    expect(decoded.sport).toBe('running')
    expect(decoded.trackpoints).toHaveLength(2)
    expect(decoded.trackpoints[1].distanceMeters).toBe(20)
  })
})

describe('readSharedPayloadFromHash', () => {
  it('returns the payload for a share hash and null for everything else', () => {
    expect(readSharedPayloadFromHash(`${SHARE_HASH_PREFIX}1AbC`)).toBe('1AbC')
    expect(readSharedPayloadFromHash('')).toBeNull()
    expect(readSharedPayloadFromHash('#other=1')).toBeNull()
    expect(readSharedPayloadFromHash(SHARE_HASH_PREFIX)).toBeNull()
    expect(readSharedPayloadFromHash(undefined)).toBeNull()
  })
})

describe('clearSharedHash', () => {
  it('strips a share hash, preserving path and query', () => {
    history.replaceState(null, '', `/?keep=1${SHARE_HASH_PREFIX}1AbC`)
    clearSharedHash()
    expect(location.hash).toBe('')
    expect(location.search).toBe('?keep=1')
    history.replaceState(null, '', '/')
  })

  it('leaves a non-share hash alone', () => {
    history.replaceState(null, '', '/#section')
    clearSharedHash()
    expect(location.hash).toBe('#section')
    history.replaceState(null, '', '/')
  })
})
