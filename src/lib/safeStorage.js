// Web Storage that cannot throw. One copy of the guard three stores were each
// carrying their own version of (credentialStore, dateRangeStore,
// viewPrefsStore), extracted before a fourth — Strava's token store — could
// make it four.
//
// **Why every single call is wrapped, and not just the writes.** Safari's
// private mode throws `QuotaExceededError` on `setItem`; some hardened browser
// configurations throw on *reading the `localStorage` property itself*, before
// any get or set is attempted. Both are real, both are rare, and both would
// otherwise surface as an exception inside a React event handler or a `useState`
// initialiser — which takes the whole app down. Degrading to "nothing was
// remembered" turns one opt-in feature off instead.
//
// **This module decides nothing about *which* storage.** That choice is
// per-store, deliberate, and documented at each call site — an API key or an
// OAuth token in `localStorage` because re-authenticating every visit defeats
// the phone use case, a chart view or a date filter in `sessionStorage` because
// it is worth remembering for one sitting and no longer. Flattening those into
// one default here would erase three stated decisions; the factory takes the
// storage as an argument precisely so each store keeps making its own, and so
// tests can inject a fake without touching globals.
//
// **What stays in the stores:** their key constant, their `SCHEMA_VERSION`, and
// their `normalize*` validator. Validation is not a storage concern — it is a
// schema concern, and the *reason* each store validates rather than merely
// parsing differs (see each header). This module never inspects a value beyond
// "did JSON.parse survive".

/**
 * The guarded property read. Returns null rather than throwing when the
 * browser refuses to expose storage at all.
 * @returns {Storage|null}
 */
export function localStorageOrNull() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** @returns {Storage|null} — see localStorageOrNull. */
export function sessionStorageOrNull() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

/**
 * @typedef {object} SafeStorage
 * @property {(key: string) => string|null} getString
 * @property {(key: string, value: string) => boolean} setString
 * @property {(key: string) => void} remove
 * @property {(key: string) => unknown} getJson
 * @property {(key: string, value: unknown) => boolean} setJson
 */

/**
 * Wraps a Storage (or null, or any `getItem`/`setItem`/`removeItem` fake) so
 * that no operation on it can throw.
 *
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [storage]
 * @returns {SafeStorage}
 */
export function createSafeStorage(storage) {
  return {
    /**
     * @returns {string|null} null means "nothing stored" — including every
     * failure, **and including an empty string**. All three original stores
     * used `|| null` rather than `?? null` here: a blank credential is not a
     * credential, and a blank JSON payload is not a payload. Preserved as the
     * contract rather than left to each caller to remember.
     */
    getString(key) {
      try {
        return storage?.getItem(key) || null
      } catch {
        return null
      }
    },

    /** @returns {boolean} false when the browser refused to persist it. */
    setString(key, value) {
      try {
        if (!storage) return false
        storage.setItem(key, value)
        return true
      } catch {
        // Quota exhausted, or storage refused outright.
        return false
      }
    },

    remove(key) {
      try {
        storage?.removeItem(key)
      } catch {
        // Already unreachable storage holds nothing to clear.
      }
    },

    /**
     * @returns {unknown} null when absent, unreachable, **or unparseable** —
     * one answer, because a caller can do nothing different about any of them.
     * The value is returned raw; validating it against a schema is the store's
     * job, not this module's.
     */
    getJson(key) {
      const stored = this.getString(key)
      if (stored === null) return null
      try {
        return JSON.parse(stored)
      } catch {
        return null
      }
    },

    /** @returns {boolean} false when it could not be serialised or persisted. */
    setJson(key, value) {
      let serialised
      try {
        serialised = JSON.stringify(value)
      } catch {
        // A cycle or a BigInt. Nothing this app stores can produce one, but a
        // throw here would defeat the entire point of the module.
        return false
      }
      return this.setString(key, serialised)
    },
  }
}
