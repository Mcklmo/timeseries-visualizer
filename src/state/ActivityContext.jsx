// Publishes the currently loaded Activity plus load lifecycle status. See
// ARCHITECTURE.md §10 for the state shape. Talks only to the injected
// ActivitySource (data/ActivitySource.js) — never to a concrete adapter.
import { createContext, useCallback, useContext, useState } from 'react'
import { useActivitySource } from '../data/ActivitySource.js'

const ActivityContext = createContext(undefined)

const IDLE = { activity: null, ref: null, status: 'idle', error: null }

export function ActivityProvider({ children }) {
  const source = useActivitySource()
  const [state, setState] = useState(IDLE)

  const load = useCallback(
    (ref) => {
      setState({ activity: null, ref: null, status: 'loading', error: null })
      return source.load(ref).then(
        // The ref that PRODUCED this activity, published alongside it. Until
        // now it was thrown away, so nothing downstream could tell a dropped
        // .fit from a Strava sync — which is exactly the question the FIT
        // export has to answer before it offers a button (ui/ExportFitButton).
        //
        // It belongs here and not on Activity: Activity is domain/'s type,
        // produced by normalizeActivity, which has never seen a file, and
        // hanging a File off it would invert ARCHITECTURE.md §3's dependency
        // rule. It must also never become an Activity field for a second
        // reason — domain/activityKey.js fingerprints Activity into its id, and
        // provenance is precisely what was left out of that key so a dropped
        // file and its intervals.icu download share one identity.
        (activity) => setState({ activity, ref, status: 'ready', error: null }),
        (error) => setState({ activity: null, ref: null, status: 'error', error }),
      )
    },
    [source],
  )

  return <ActivityContext.Provider value={{ ...state, load }}>{children}</ActivityContext.Provider>
}

export function useActivity() {
  const ctx = useContext(ActivityContext)
  if (ctx === undefined) {
    throw new Error('useActivity must be used within an ActivityProvider')
  }
  return ctx
}
