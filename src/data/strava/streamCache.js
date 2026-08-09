// A tiny in-memory LRU for stream sets, wired inside StravaActivitySource.load.
//
// **In memory, NOT sessionStorage** — and this is the interesting decision.
// A 90-minute run at 1 Hz is ~5,400 samples across 7 streams: 300–600 KB of
// JSON. The per-origin sessionStorage budget is around 5 MB and is already
// shared with viewPrefsStore, which writes one entry per activity viewed.
// Overflowing it throws QuotaExceededError, and `viewPrefsStore.save`
// **swallows that silently** by design — so the visible symptom of putting
// streams there would not be "the cache stopped working", it would be
// *remembered chart views randomly stop working*, on a different feature,
// with no error anywhere. Memory has no such budget to blow.
//
// The cost of memory is that a reload empties it. That is the right trade
// twice over: the cache exists to make ErrorState's "Try again" and a
// back-then-reopen free, both of which happen within one page life — and
// evaporation is what makes API Policy §6.3 (delete within 48h of a user
// action) and §7.4 (within 30 days of revocation) automatic rather than
// something this app has to implement and prove.
//
// **No TTL.** An activity's streams are immutable: Strava does not
// retroactively change what a watch recorded. A 15-minute TTL would only
// re-fetch identical bytes. (The activity *list* is different — it changes the
// moment the athlete uploads — and its cache is a separate thing with a real
// TTL.)

/** Eight is a few activities' worth of comparing, and ~4 MB at the top end of
 *  the size estimate above. Large enough to be useful, small enough that it
 *  cannot become the reason a tab is holding 100 MB. */
export const STREAM_CACHE_MAX_ENTRIES = 8

/**
 * A Map is already insertion-ordered, so LRU is: delete-then-set on every read
 * to move an entry to the end, and evict from the front when over capacity.
 * No dependency, no linked list.
 */
export function createStreamCache(maxEntries = STREAM_CACHE_MAX_ENTRIES) {
  const entries = new Map()

  return {
    /** @param {string} activityId @returns {object|undefined} */
    get(activityId) {
      if (!entries.has(activityId)) return undefined
      const value = entries.get(activityId)
      // Re-inserting is what makes this least-*recently-used* rather than
      // least-recently-written.
      entries.delete(activityId)
      entries.set(activityId, value)
      return value
    },

    /** @param {string} activityId @param {object} streams */
    set(activityId, streams) {
      entries.delete(activityId)
      entries.set(activityId, streams)
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value)
      }
    },

    /** Disconnect calls this. Nothing derived from the athlete's data may
     *  outlive their grant, even in memory. */
    clear() {
      entries.clear()
    },

    get size() {
      return entries.size
    },
  }
}

/**
 * The app-wide instance — same "one instance, tests inject their own" pattern
 * as credentialStore and stravaTokenStore, and it exists for one concrete
 * reason: **Disconnect has to be able to clear it.**
 *
 * StravaActivitySource takes the cache as a constructor argument and would
 * otherwise default to a private one, which is unreachable from the UI. The
 * §7.4 obligation is the one thing evaporation cannot satisfy on its own: a tab
 * that stays open after the athlete revokes the grant would still be holding
 * their telemetry in memory. So the instance is named here, `sourceRegistry`
 * passes it to the adapter, and StravaPage's disconnect clears it.
 */
export const stravaStreamCache = createStreamCache()
