// The share-link codec: Activity -> `#a=1<base64url>` and back. Issue #4's
// "compression mechanism that encodes an activity in a base64 string short
// enough to use as a url parameter", for an app with no server-side storage
// to point a link at.
//
// **The payload lives in the HASH, not the query string.** The fragment is
// never sent to the server, so no edge or proxy URL-length limit applies; the
// Strava OAuth strip explicitly preserves it (useStravaOAuthCallback.js:179,
// "this app puts nothing there today" — now it does); and it creates no fake
// paths for analytics or the asset server, which deliberately has SPA
// not_found_handling off.
//
// **Wire shape:** one version character `'1'`, then base64url (RFC 4648 §5,
// unpadded) of gzip(body). The version sits OUTSIDE the compression on
// purpose, so a v2 is free to change the compression itself, not just the
// body layout. The body is columnar — header fields, then every sample's t,
// then every sample's d, then each optional column contiguously — because
// column-major is what makes gzip earn its keep here: the same activity
// interleaved row-major compresses ~3x worse.
//
// Per column: quantize each absolute value to an integer grid, THEN delta,
// then LEB128 varint (zigzag for signed columns). Quantize-then-delta means
// rounding error never accumulates along the activity — the sum of encoded
// deltas IS the quantized absolute value. Precisions: t/d at 0.1 (exact for
// Garmin's integer-second, cm-distance records), lat/lon at 1e-5 deg ≈ 1.1 m
// (the Google-polyline standard, under buildTrack.js's 2.4 m visibility
// threshold), altitude 0.1 m, speed 0.01 m/s, hr/cadence/power integers.
//
// **Only raw inputs are encoded, never derived state.** Decoding rebuilds
// RawTrackpoint[] and hands them to normalizeActivity, which re-derives the
// distance axis, speed smoothing, pauses, availableMetrics, the track and the
// id — one pipeline, not two. (Consequence: a shared copy's Activity.id
// differs from the original's, since quantization nudges the fingerprint
// inputs — remembered view prefs deliberately do not transfer.)
//
// **Budget.** Measured on the real fixture (1,801-sample 30-min run, six
// columns): ~5.5K chars at full 1 Hz, ~3.1 chars/sample. At the 32,000-char
// budget everything up to a half-marathon ships at full resolution; a
// 20k-sample ride lands at ~3-4 s. Activities over budget are stride-
// decimated (every k-th sample plus the last, so totals survive) — inside the
// encoder, NOT in domain/downsample.js, which is reserved for display-time
// LTTB per ARCHITECTURE.md §7 and simplifyTrack.js's header.
//
// **A share URL is attacker-controlled input.** Decoding follows
// viewPrefsStore.js's reject-don't-repair philosophy, but throws (with copy
// written for the person holding the link) instead of returning null, because
// ActivityContext surfaces load rejections in ErrorState. Every varint is
// bounds-checked, the inflate is byte-capped against gzip bombs, every value
// is range-checked against the same table the encoder quantizes with — so the
// encoder cannot produce a payload the decoder refuses — and trailing bytes
// reject.
import { unprojectXY } from '../../domain/webMercator.js'
import { fromBase64Url, toBase64Url } from '../../lib/base64url.js'

/**
 * Cap on the whole payload (`1` + base64url), and therefore in effect on the
 * share URL. 32,000 was chosen over a "safe everywhere" 2,000 deliberately:
 * the short link from POST /api/share is what actually travels through
 * messaging apps, so this cap only governs the serverless fallback URL and
 * how much resolution a long activity keeps. One knob; the size math above.
 */
export const SHARE_URL_MAX_CHARS = 32000

export const SHARE_HASH_PREFIX = '#a='

/**
 * The one payload that is not a payload: `GET /s/<id>` redirects here on a KV
 * miss, so the ordinary hash-loading path can say "that link no longer
 * resolves" without a second URL grammar. Can never collide with a real
 * payload — those start with a version digit.
 */
export const MISSING_PAYLOAD = 'missing'

/** Decode-failure copy, keyed so tests can pin identity rather than prose. */
export const SHARE_MESSAGES = {
  damaged: 'This share link is damaged or incomplete — ask for it to be sent again.',
  newer:
    'This share link was made with a newer version of ActivityMaxxer. Reload the page and open the link again.',
  missing: 'This share link could not be found — it may have expired. Ask for a fresh link.',
  tooSmall: 'This activity has too little data to share.',
}

const VERSION_CHAR = '1'
// Pre-inflate cap: well past any real payload, cheap to check before work.
const MAX_PAYLOAD_CHARS = 128000
// Post-inflate cap — the gzip-bomb guard. 100k samples at worst-case varint
// widths stays far under this.
const MAX_DECODED_BYTES = 4 * 1024 * 1024
const MAX_SAMPLES = 100000
const MIN_SAMPLES = 2
const MAX_NAME_BYTES = 512
// 120 chars is at most 480 UTF-8 bytes, safely under MAX_NAME_BYTES.
const ENCODED_NAME_MAX_CHARS = 120
// 5 x 7 payload bits = 2^35: room for epoch seconds and every column's
// zigzagged range, and a hard stop against overlong-varint tricks.
const MAX_VARINT_BYTES = 5
// Cumulative caps on the two monotonic axes: ten years of deciseconds, and
// 40,000 km of decimeters. Nothing a wearable records exceeds either.
const MAX_TOTAL_DECISECONDS = 10 * 366 * 24 * 3600 * 10
const MAX_TOTAL_DECIMETERS = 4e8
const TEN_YEARS_SECONDS = 10 * 366 * 24 * 3600

const SPORTS = ['running', 'cycling', 'track']
const POSITION_BIT = 1
const LAT_SCALE = 1e5
const MAX_LAT_Q = 90 * LAT_SCALE
const MAX_LON_Q = 180 * LAT_SCALE

/**
 * The optional scalar columns, in payload order (position, bit 0, is handled
 * separately — it is a pair with a shared bitmap). ONE table for both
 * directions: the encoder treats a value outside [min, max] (on the quantized
 * grid) as absent, the decoder rejects it — so every encodable value decodes.
 */
const SCALAR_COLUMNS = [
  { bit: 1 << 1, sampleKey: 'altitude', rawKey: 'altitudeMeters', scale: 10, min: -10000, max: 100000 },
  { bit: 1 << 2, sampleKey: 'heartRate', rawKey: 'heartRateBpm', scale: 1, min: 0, max: 300 },
  { bit: 1 << 3, sampleKey: 'cadence', rawKey: 'cadenceSpm', scale: 1, min: 0, max: 500 },
  { bit: 1 << 4, sampleKey: 'power', rawKey: 'watts', scale: 1, min: 0, max: 5000 },
  { bit: 1 << 5, sampleKey: 'speed', rawKey: 'speedMps', scale: 100, min: 0, max: 20000 },
]
const KNOWN_BITS_MASK = 0b111111

function damagedError() {
  return new Error(SHARE_MESSAGES.damaged)
}

// ---------------------------------------------------------------------------
// Encoding

/**
 * The in-memory Activity — whatever source it loaded from — as a share
 * payload no longer than `maxChars`, decimating only when it must.
 *
 * @param {import('../../domain/types.js').Activity} activity
 * @param {{maxChars?: number}} [options]
 * @returns {Promise<string>}
 */
export async function encodeActivityToPayload(activity, { maxChars = SHARE_URL_MAX_CHARS } = {}) {
  const total = activity?.samples?.length ?? 0
  if (total < MIN_SAMPLES) throw new Error(SHARE_MESSAGES.tooSmall)

  // Chars-per-sample RISES as stride grows (bigger deltas, less redundancy
  // for gzip), so the ratio estimate undershoots and the loop re-tries; it
  // converges in 2-3 passes, each a few ms.
  let stride = 1
  for (;;) {
    const payload = await encodeAtStride(activity, stride)
    if (payload.length <= maxChars) return payload
    if (Math.ceil(total / stride) <= MIN_SAMPLES) {
      // First-and-last alone did not fit — only reachable with a test-sized
      // maxChars, but a loop that cannot terminate is not worth the trust.
      throw new Error(SHARE_MESSAGES.tooSmall)
    }
    stride = Math.max(stride + 1, Math.ceil((stride * payload.length) / maxChars))
  }
}

async function encodeAtStride(activity, stride) {
  const body = buildBody(activity, pickIndices(activity.samples.length, stride))
  return VERSION_CHAR + toBase64Url(await gzipBytes(body))
}

/** Every stride-th index, plus the last — totals must survive decimation. */
function pickIndices(total, stride) {
  const indices = []
  for (let i = 0; i < total; i += stride) indices.push(i)
  if (indices[indices.length - 1] !== total - 1) indices.push(total - 1)
  return indices
}

function buildBody(activity, indices) {
  const out = []
  const sportCode = SPORTS.indexOf(activity.sport)
  // An unknown sport encodes as 'track' (the generic GPS log) rather than
  // failing the whole share over an enum this codec has not learned yet.
  out.push(sportCode === -1 ? SPORTS.indexOf('track') : sportCode)
  writeUvarint(out, Math.max(0, Math.round(activity.startTime.getTime() / 1000)))

  const nameBytes = new TextEncoder().encode((activity.name ?? '').slice(0, ENCODED_NAME_MAX_CHARS))
  writeUvarint(out, nameBytes.length)
  for (const byte of nameBytes) out.push(byte)

  const positions = readPositions(activity, indices)
  const scalars = SCALAR_COLUMNS.map((column) => readScalarColumn(activity.samples, indices, column))

  let mask = positions.some((p) => p !== null) ? POSITION_BIT : 0
  for (let c = 0; c < SCALAR_COLUMNS.length; c += 1) {
    if (scalars[c].some((v) => v !== null)) mask |= SCALAR_COLUMNS[c].bit
  }
  out.push(mask)
  writeUvarint(out, indices.length)

  // The two always-present monotonic axes. Quantize-then-delta with the
  // running previous QUANTIZED value, so error cannot accumulate; the clamp
  // to the previous value makes the delta provably non-negative even if a
  // float wobble ever produced a microscopic decrease.
  let prevT = 0
  let prevD = 0
  for (const i of indices) {
    const q = Math.max(prevT, Math.round(activity.samples[i].t * 10))
    writeUvarint(out, q - prevT)
    prevT = q
  }
  for (const i of indices) {
    const q = Math.max(prevD, Math.round(activity.samples[i].d * 10))
    writeUvarint(out, q - prevD)
    prevD = q
  }

  if (mask & POSITION_BIT) {
    writeBitmap(
      out,
      positions.map((p) => p !== null),
    )
    writePresentDeltas(
      out,
      positions.map((p) => (p === null ? null : p.latQ)),
    )
    writePresentDeltas(
      out,
      positions.map((p) => (p === null ? null : p.lonQ)),
    )
  }
  for (let c = 0; c < SCALAR_COLUMNS.length; c += 1) {
    if (!(mask & SCALAR_COLUMNS[c].bit)) continue
    writeBitmap(
      out,
      scalars[c].map((v) => v !== null),
    )
    writePresentDeltas(out, scalars[c])
  }
  return Uint8Array.from(out)
}

/**
 * lat/lon per picked index, recovered from the pre-projected track — the only
 * place an in-memory Activity keeps positions (buildTrack.js). NaN slots (no
 * fix) come back null and stay null through the round trip, so the decoded
 * track breaks its stroke in the same places.
 */
function readPositions(activity, indices) {
  const track = activity.track
  return indices.map((i) => {
    if (!track || !Number.isFinite(track.x[i]) || !Number.isFinite(track.y[i])) return null
    const { lat, lon } = unprojectXY(track.x[i], track.y[i])
    const latQ = Math.round(lat * LAT_SCALE)
    const lonQ = Math.round(lon * LAT_SCALE)
    // Unreachable off a real track (the projection clamps to ±85.05°), kept so
    // the "encoder never produces what the decoder rejects" invariant is
    // checked here rather than assumed.
    if (Math.abs(latQ) > MAX_LAT_Q || Math.abs(lonQ) > MAX_LON_Q) return null
    return { latQ, lonQ }
  })
}

/** Quantized values per picked index; null where absent, non-finite, or out of the column's range. */
function readScalarColumn(samples, indices, { sampleKey, scale, min, max }) {
  return indices.map((i) => {
    const value = samples[i][sampleKey]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    const q = Math.round(value * scale)
    return q < min || q > max ? null : q
  })
}

/** Zigzag varint deltas over the non-null slots only; first delta is vs 0. */
function writePresentDeltas(out, values) {
  let prev = 0
  for (const value of values) {
    if (value === null) continue
    writeUvarint(out, toZigzag(value - prev))
    prev = value
  }
}

// ---------------------------------------------------------------------------
// Decoding

/**
 * @param {string} payload the hash's `#a=` remainder, attacker-controlled
 * @returns {Promise<{sport: import('../../domain/types.js').Sport, name: string,
 *   trackpoints: import('../../domain/types.js').RawTrackpoint[]}>}
 * @throws {Error} with SHARE_MESSAGES copy on anything malformed
 */
export async function decodePayload(payload) {
  if (typeof payload !== 'string') throw damagedError()
  if (payload === MISSING_PAYLOAD) throw new Error(SHARE_MESSAGES.missing)
  if (payload.length < 2 || payload.length > MAX_PAYLOAD_CHARS) throw damagedError()

  const version = payload[0]
  if (version !== VERSION_CHAR) {
    // A higher version digit is a real signal — someone's newer share opened
    // in an older cached bundle. Anything else is just not a payload.
    throw new Error(/^[2-9]$/.test(version) ? SHARE_MESSAGES.newer : SHARE_MESSAGES.damaged)
  }

  let body
  try {
    body = await gunzipCapped(fromBase64Url(payload.slice(1)), MAX_DECODED_BYTES)
  } catch {
    throw damagedError()
  }
  return parseBody(body)
}

function parseBody(bytes) {
  const reader = { bytes, offset: 0 }

  const sportCode = readByte(reader)
  if (sportCode >= SPORTS.length) throw damagedError()
  const startSeconds = readUvarint(reader)
  if (startSeconds > Date.now() / 1000 + TEN_YEARS_SECONDS) throw damagedError()

  const nameLength = readUvarint(reader)
  if (nameLength > MAX_NAME_BYTES) throw damagedError()
  const name = new TextDecoder().decode(readBytes(reader, nameLength))

  const mask = readByte(reader)
  if (mask & ~KNOWN_BITS_MASK) throw damagedError()
  const count = readUvarint(reader)
  if (count < MIN_SAMPLES || count > MAX_SAMPLES) throw damagedError()

  const tDs = readMonotonicColumn(reader, count, MAX_TOTAL_DECISECONDS)
  const dDm = readMonotonicColumn(reader, count, MAX_TOTAL_DECIMETERS)

  let latQ = null
  let lonQ = null
  if (mask & POSITION_BIT) {
    const present = readBitmap(reader, count)
    latQ = readPresentDeltas(reader, present, -MAX_LAT_Q, MAX_LAT_Q)
    lonQ = readPresentDeltas(reader, present, -MAX_LON_Q, MAX_LON_Q)
  }
  const scalarValues = SCALAR_COLUMNS.map((column) => {
    if (!(mask & column.bit)) return null
    const present = readBitmap(reader, count)
    return readPresentDeltas(reader, present, column.min, column.max)
  })

  // Anything after the last column is not slack, it is a different payload
  // than this parser read — and "parsed a prefix of it" must not count.
  if (reader.offset !== bytes.length) throw damagedError()

  const startMs = startSeconds * 1000
  const trackpoints = []
  for (let i = 0; i < count; i += 1) {
    /** @type {import('../../domain/types.js').RawTrackpoint} */
    const tp = { time: new Date(startMs + tDs[i] * 100), distanceMeters: dDm[i] / 10 }
    if (latQ !== null && latQ[i] !== null) {
      tp.lat = latQ[i] / LAT_SCALE
      tp.lon = lonQ[i] / LAT_SCALE
    }
    for (let c = 0; c < SCALAR_COLUMNS.length; c += 1) {
      const values = scalarValues[c]
      if (values !== null && values[i] !== null) {
        tp[SCALAR_COLUMNS[c].rawKey] = values[i] / SCALAR_COLUMNS[c].scale
      }
    }
    trackpoints.push(tp)
  }

  return { sport: SPORTS[sportCode], name, trackpoints }
}

/** Non-negative deltas accumulated under a cumulative cap — t and d. */
function readMonotonicColumn(reader, count, maxTotal) {
  const values = new Array(count)
  let total = 0
  for (let i = 0; i < count; i += 1) {
    total += readUvarint(reader)
    if (total > maxTotal) throw damagedError()
    values[i] = total
  }
  return values
}

/**
 * The inverse of writePresentDeltas: null in the absent slots, reconstructed
 * quantized values elsewhere, each checked against the column's range — which
 * also bounds the running value against drift-past-anything-sane payloads.
 */
function readPresentDeltas(reader, present, min, max) {
  const values = new Array(present.length)
  let prev = 0
  for (let i = 0; i < present.length; i += 1) {
    if (!present[i]) {
      values[i] = null
      continue
    }
    prev += fromZigzag(readUvarint(reader))
    if (prev < min || prev > max) throw damagedError()
    values[i] = prev
  }
  return values
}

// ---------------------------------------------------------------------------
// Bit plumbing

/** LSB-first within each byte, `ceil(n/8)` bytes; an all-ones run gzips to nothing. */
function writeBitmap(out, flags) {
  for (let i = 0; i < flags.length; i += 8) {
    let byte = 0
    for (let bit = 0; bit < 8 && i + bit < flags.length; bit += 1) {
      if (flags[i + bit]) byte |= 1 << bit
    }
    out.push(byte)
  }
}

function readBitmap(reader, count) {
  const bytes = readBytes(reader, Math.ceil(count / 8))
  const flags = new Array(count)
  for (let i = 0; i < count; i += 1) {
    flags[i] = ((bytes[i >> 3] >> (i & 7)) & 1) === 1
  }
  return flags
}

// LEB128 in ordinary float arithmetic, never 32-bit bitwise ops: column
// values reach 2^35 zigzagged, comfortably exact in a double and truncated to
// garbage by `>>`/`|`.
function writeUvarint(out, value) {
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

function readUvarint(reader) {
  let value = 0
  let scale = 1
  for (let i = 0; i < MAX_VARINT_BYTES; i += 1) {
    const byte = readByte(reader)
    value += (byte & 0x7f) * scale
    if ((byte & 0x80) === 0) return value
    scale *= 0x80
  }
  // A sixth continuation byte encodes past 2^35 — nothing this format carries.
  throw damagedError()
}

const toZigzag = (n) => (n >= 0 ? n * 2 : -n * 2 - 1)
const fromZigzag = (z) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2)

function readByte(reader) {
  if (reader.offset >= reader.bytes.length) throw damagedError()
  const byte = reader.bytes[reader.offset]
  reader.offset += 1
  return byte
}

function readBytes(reader, count) {
  if (reader.offset + count > reader.bytes.length) throw damagedError()
  const slice = reader.bytes.subarray(reader.offset, reader.offset + count)
  reader.offset += count
  return slice
}

// ---------------------------------------------------------------------------
// gzip via the platform streams — the pattern set by fileFormat.js.
//
// **Response, never Blob.** Under jsdom, `Blob` is jsdom's while
// `CompressionStream`/`DecompressionStream` and `Response` are Node's — jsdom
// implements none of the latter, so they survive on globalThis. Feeding a
// jsdom Blob into a Node stream breaks; going through `Response` keeps
// everything on one side.

async function gzipBytes(bytes) {
  const zipped = await new Response(
    new Response(bytes).body.pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  return new Uint8Array(zipped)
}

/**
 * Inflate with a running byte cap, chunk by chunk — `arrayBuffer()` on the
 * whole stream would hand a 40-byte gzip bomb however much memory it asks
 * for before anything could refuse it. A corrupt stream rejects out of
 * `read()`, which the caller maps to the damaged-link copy.
 */
async function gunzipCapped(bytes, maxBytes) {
  const reader = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw damagedError()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

// ---------------------------------------------------------------------------
// The URL side of the format, kept beside it so the prefix has one home.

/**
 * The share payload carried by a location.hash, or null on an ordinary load.
 * One string comparison on the no-share path — sniff-before-cost, the same
 * contract readCallbackParams gives the OAuth hook.
 * @param {string|null|undefined} hash
 * @returns {string|null}
 */
export function readSharedPayloadFromHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(SHARE_HASH_PREFIX)) return null
  const payload = hash.slice(SHARE_HASH_PREFIX.length)
  return payload.length > 0 ? payload : null
}

/**
 * Drops a share hash from the address bar — called when a NON-shared load
 * lands, so the URL never describes an activity that is no longer on screen.
 * A hash that isn't a share payload is left alone; kept-after-load is the
 * policy for shared loads themselves (a payload is idempotent to re-consume,
 * unlike the OAuth code, so the link stays bookmarkable and re-shareable).
 */
export function clearSharedHash() {
  try {
    const { hash, pathname, search } = globalThis.location ?? {}
    if (typeof hash !== 'string' || !hash.startsWith(SHARE_HASH_PREFIX)) return
    globalThis.history?.replaceState?.(null, '', `${pathname ?? '/'}${search ?? ''}`)
  } catch {
    // Some embedded contexts refuse replaceState; a stale hash is cosmetic.
  }
}
