// base64url (RFC 4648 §5) over raw bytes — the repo's first base64 helper,
// kept in lib/ with the other thin browser-API wrappers (downloadBytes,
// safeStorage) because everything in it is platform plumbing, not domain.
//
// URL-safe alphabet (`-`/`_`, no `=` padding) rather than plain base64: the
// one consumer is the share-link payload, which lives inside a URL where `+`
// and `/` would need percent-encoding and `=` reads as a query delimiter.
//
// `btoa`/`atob` rather than hand-rolled sextet math: both exist in every
// target browser, in Node 22 (the test runtime) and in workerd. Their
// byte↔"binary string" impedance is contained here so no caller ever sees it.

// Well under any engine's argument-count limit for Function.prototype.apply —
// String.fromCharCode(...chunk) with an unbounded chunk is a RangeError on a
// long ride's payload, which is exactly the size this helper exists for.
const CHUNK_SIZE = 0x8000

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url, unpadded
 */
export function toBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Strict inverse: rejects anything outside the unpadded base64url alphabet
 * rather than letting `atob`'s laxer grammar (whitespace, `+`, `/`, `=`)
 * quietly accept a string `toBase64Url` could never have produced. The one
 * caller feeds it attacker-controlled URL content; see shareCodec.js.
 *
 * @param {string} text
 * @returns {Uint8Array}
 * @throws {Error} on any character outside [A-Za-z0-9_-] or an impossible length
 */
export function fromBase64Url(text) {
  if (typeof text !== 'string' || /[^A-Za-z0-9_-]/.test(text)) {
    throw new Error('not base64url')
  }
  // Length ≡ 1 (mod 4) encodes no whole byte; atob accepts some such strings.
  if (text.length % 4 === 1) throw new Error('not base64url')
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
