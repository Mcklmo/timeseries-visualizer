// Where the intervals.icu API key lives between visits.
//
// HARD RULES, because this key is a password rather than a session token —
// unscoped (the same Basic scheme authorises PUT/DELETE across the athlete's
// whole account), with no expiry and no revocation short of regenerating it
// in intervals.icu's settings:
//
//   - it never goes in a URL, only in an Authorization header
//   - it never goes into a log, an error message, or a thrown object
//   - it never goes to this app's own Worker — the browser talks to
//     intervals.icu directly, so the key has exactly one destination
//   - it never auto-fills the feedback form
//
// localStorage is the owner's deliberate choice: on a phone, re-pasting a key
// every visit would defeat the point of the feature. The cost — readable by
// any script on the origin, indefinitely, including on a device someone
// connected once and forgot — is stated plainly in the connect form, and
// Disconnect's copy says it removes the key *locally* without revoking it
// upstream. The storage is a factory argument precisely so that trade can be
// revisited: sessionStorage, or a "keep me signed in" checkbox, is a one-line
// change here and nothing elsewhere.
//
// Every call goes through lib/safeStorage.js, which cannot throw: Safari's
// private mode throws on setItem and some hardened configurations throw on any
// Storage access at all. A throw inside a React event handler would take the
// app down, where degrading to "not connected" merely turns one opt-in feature
// off. That guard used to be written out three times across the repo; the
// reasoning behind it now lives in one header.
import { createSafeStorage, localStorageOrNull } from '../../lib/safeStorage.js'

export const API_KEY_STORAGE_KEY = 'timeseries-visualizer.intervals-icu.apiKey'

/**
 * **localStorage, deliberately** — the opposite of what dateRangeStore.js next
 * door and state/viewPrefsStore.js choose, for the reason in the header above.
 * It stays a factory argument so that trade is still one line to revisit.
 *
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [storage]
 * @returns {{readApiKey: () => string|null, saveApiKey: (apiKey: string) => boolean, clearApiKey: () => void}}
 */
export function createCredentialStore(storage = localStorageOrNull()) {
  const safe = createSafeStorage(storage)
  return {
    /** @returns {string|null} null means "not connected" — including every
     *  failure, and including a blank stored value, which is not a credential
     *  (safeStorage's `getString` contract). */
    readApiKey() {
      return safe.getString(API_KEY_STORAGE_KEY)
    },

    /** @returns {boolean} false when the browser refused to persist it. */
    saveApiKey(apiKey) {
      return safe.setString(API_KEY_STORAGE_KEY, apiKey)
    },

    clearApiKey() {
      safe.remove(API_KEY_STORAGE_KEY)
    },
  }
}

/** The app-wide instance. Tests inject their own store instead. */
export const credentialStore = createCredentialStore()
