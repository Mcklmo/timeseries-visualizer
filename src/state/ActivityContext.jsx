// Publishes the currently loaded Activity plus load lifecycle status. See
// ARCHITECTURE.md §10 for the state shape. Talks only to the injected
// ActivitySource (data/ActivitySource.js) — never to a concrete adapter.
import { createContext, useCallback, useContext, useState } from 'react'
import { useActivitySource } from '../data/ActivitySource.js'

const ActivityContext = createContext(undefined)

const IDLE = { activity: null, status: 'idle', error: null }

export function ActivityProvider({ children }) {
  const source = useActivitySource()
  const [state, setState] = useState(IDLE)

  const load = useCallback(
    (ref) => {
      setState({ activity: null, status: 'loading', error: null })
      return source.load(ref).then(
        (activity) => setState({ activity, status: 'ready', error: null }),
        (error) => setState({ activity: null, status: 'error', error }),
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
