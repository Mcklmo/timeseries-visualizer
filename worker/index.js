// Worker entry point (wrangler.jsonc `main`). This is the "Workers with static
// assets" model, not Cloudflare Pages: there is no `functions/` auto-routing
// convention here, so the API route is matched explicitly and everything else
// is handed to the static-assets binding, which serves ./dist.
import { handleFeedbackRequest } from './routes/feedback.js'
import { STRAVA_ROUTE_PREFIX, handleStravaRequest } from './routes/strava.js'
import { TILES_ROUTE_PREFIX, handleTilesRequest } from './routes/tiles.js'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/feedback') return handleFeedbackRequest(request, env)
    // A prefix, not an exact path: routes/strava.js owns its own sub-routing,
    // so the five Strava endpoints stay one line here. The OAuth *callback*
    // needs nothing — it lands on `/`, which is already served below.
    if (url.pathname.startsWith(STRAVA_ROUTE_PREFIX)) return handleStravaRequest(request, env)
    // Basemap tiles for the route map panel. Same shape as Strava's: the route
    // owns its own path parsing and validation, so this stays one line.
    if (url.pathname.startsWith(TILES_ROUTE_PREFIX)) return handleTilesRequest(request, env)
    return env.ASSETS.fetch(request)
  },
}
