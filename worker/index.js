// Worker entry point (wrangler.jsonc `main`). This is the "Workers with static
// assets" model, not Cloudflare Pages: there is no `functions/` auto-routing
// convention here, so the API route is matched explicitly and everything else
// is handed to the static-assets binding, which serves ./dist.
import { handleFeedbackRequest } from './routes/feedback.js'
import {
  SHARE_API_PATH,
  SHARE_LINK_PREFIX,
  handleShareLinkRequest,
  handleShareRequest,
} from './routes/share.js'
import { STRAVA_ROUTE_PREFIX, handleStravaRequest } from './routes/strava.js'
import { TILES_ROUTE_PREFIX, handleTilesRequest } from './routes/tiles.js'
import { handleUsageRequest } from './routes/usage.js'
import { USAGE_API_PATH } from '../shared/usageEvents.js'
import { recordPageView } from './lib/usageAnalytics.js'

export default {
  // Page views are counted here, around the router, rather than in any route:
  // a navigation to `/`, `/about` or `/s/<id>` is one fact however it is
  // answered. recordPageView ignores everything that is not a browser opening
  // a page, and writes nothing identifying — see lib/usageAnalytics.js. The
  // Worker only sees page requests at all because wrangler.jsonc routes them
  // here first (`assets.run_worker_first`); hashed bundles still go straight
  // to the asset server.
  async fetch(request, env) {
    const response = await route(request, env)
    recordPageView(env, request, response)
    return response
  },
}

/** @param {Request} request @param {object} env */
function route(request, env) {
  const url = new URL(request.url)
  if (url.pathname === USAGE_API_PATH) return handleUsageRequest(request, env)
  if (url.pathname === '/api/feedback') return handleFeedbackRequest(request, env)
  // A prefix, not an exact path: routes/strava.js owns its own sub-routing,
  // so the five Strava endpoints stay one line here. The OAuth *callback*
  // needs nothing — it lands on `/`, which is already served below.
  if (url.pathname.startsWith(STRAVA_ROUTE_PREFIX)) return handleStravaRequest(request, env)
  // Basemap tiles for the route map panel. Same shape as Strava's: the route
  // owns its own path parsing and validation, so this stays one line.
  if (url.pathname.startsWith(TILES_ROUTE_PREFIX)) return handleTilesRequest(request, env)
  // Share links: the API creates them, and /s/<id> — the one non-/api path
  // this Worker answers itself — redirects into the app. It must be matched
  // here rather than left to fall through: the asset server has no /s/ and
  // SPA not_found_handling is deliberately off, so falling through is a 404.
  if (url.pathname === SHARE_API_PATH) return handleShareRequest(request, env)
  if (url.pathname.startsWith(SHARE_LINK_PREFIX)) return handleShareLinkRequest(request, env)
  return env.ASSETS.fetch(request)
}
