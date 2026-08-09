// Where the athlete's Strava tokens live between visits.
//
// **localStorage, matching credentialStore.js's documented trade** and for the
// same reason: on a phone, re-authenticating every visit defeats the point of
// the feature. The cost is the same too — readable by any script on the origin,
// indefinitely, including on a device someone connected once and forgot.
//
// **Strava's credential is strictly less dangerous than the intervals.icu key,
// and this is the one place Strava's story is better.** The intervals.icu key
// is a password: unscoped, authorising PUT and DELETE across the whole account,
// with no expiry and no revocation short of regenerating it. A Strava access
// token is scoped read-only, expires in six hours, and — the part that matters
// — is **genuinely revocable from inside this app**: Disconnect calls
// /oauth/deauthorize and the grant is gone. Say so in the connect copy.
//
// **Three values, not one, and that is why this store exists rather than a
// second createCredentialStore.** An access token expires in six hours, so a
// refresh token and an expiry have to live beside it, and the refresh token
// **rotates** — every refresh returns a new one and kills the one that was
// sent. Losing that write means the athlete reconnects from scratch, so `save`
// is never partial: the whole triple is written as one JSON payload under one
// key, with no read-modify-write to get wrong.
//
// `read` VALIDATES rather than merely parsing, for the reason viewPrefsStore
// states: localStorage is hand-editable and can hold a payload from an older
// schema. Here a malformed payload that survived would send a garbage bearer
// token to the Worker and read as "Strava rejected your login".
import { createSafeStorage, localStorageOrNull } from '../../lib/safeStorage.js'

export const STRAVA_TOKENS_STORAGE_KEY = 'timeseries-visualizer.strava.tokens'

// Bumped only if the payload shape changes incompatibly. An entry that doesn't
// match is dropped, not migrated — the cost is one reconnect.
const SCHEMA_VERSION = 1

/**
 * How early a token counts as expired. A token that is valid for another two
 * seconds is not usable: the request still has to cross the network, reach the
 * Worker and reach Strava. Refreshing slightly early costs one extra call every
 * six hours; not doing it produces a 401 that looks like a revoked grant.
 */
export const EXPIRY_SKEW_MS = 60_000

/**
 * @typedef {object} StravaTokens
 * @property {string} accessToken
 * @property {string} refreshToken - rotates on every refresh; always store what came back
 * @property {number} expiresAt - epoch **milliseconds** (the Worker converts from
 *                                Strava's seconds; see worker/lib/stravaOAuth.js)
 * @property {number|null} athleteId
 */

/**
 * Anything at all -> a usable token triple, or null.
 * @param {unknown} raw
 * @returns {StravaTokens|null}
 */
function normalizeTokens(raw) {
  if (raw == null || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION) return null

  const { accessToken, refreshToken, expiresAt, athleteId } = raw
  if (typeof accessToken !== 'string' || !accessToken) return null
  if (typeof refreshToken !== 'string' || !refreshToken) return null
  // A non-finite expiry would make every comparison below false, which reads
  // as "never expires" — the one wrong answer. Refused instead.
  if (!Number.isFinite(expiresAt)) return null

  return {
    accessToken,
    refreshToken,
    expiresAt,
    athleteId: Number.isFinite(athleteId) ? athleteId : null,
  }
}

/**
 * True when `tokens` cannot be relied on for a request starting now.
 * Exported because the refresh path and its tests both need the same rule.
 *
 * Absent tokens count as expired — the caller's next step is the same either
 * way, and returning false for "nothing stored" would be a trap.
 *
 * @param {StravaTokens|null} tokens
 * @param {number} [now] epoch ms
 */
export function isExpired(tokens, now = Date.now()) {
  if (!tokens) return true
  return now >= tokens.expiresAt - EXPIRY_SKEW_MS
}

/**
 * **localStorage, deliberately** — see the header. It stays a factory argument
 * so tests inject their own and so the trade is one line to revisit.
 *
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [storage]
 */
export function createStravaTokenStore(storage = localStorageOrNull()) {
  const safe = createSafeStorage(storage)
  return {
    /** @returns {StravaTokens|null} null means "not connected" — including
     *  unreachable storage, unparseable JSON and a payload that fails
     *  validation, which are one answer to every caller. */
    read() {
      return normalizeTokens(safe.getJson(STRAVA_TOKENS_STORAGE_KEY))
    },

    /**
     * @param {StravaTokens} tokens
     * @returns {boolean} false when the browser refused to persist them. The
     *   session still works; it just won't survive a reload.
     */
    save(tokens) {
      if (!tokens) return false
      return safe.setJson(STRAVA_TOKENS_STORAGE_KEY, {
        v: SCHEMA_VERSION,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        athleteId: tokens.athleteId ?? null,
      })
    },

    clear() {
      safe.remove(STRAVA_TOKENS_STORAGE_KEY)
    },
  }
}

/** The app-wide instance. Tests inject their own store instead. */
export const stravaTokenStore = createStravaTokenStore()
