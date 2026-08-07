// Worker entry point (wrangler.jsonc `main`). This is the "Workers with static
// assets" model, not Cloudflare Pages: there is no `functions/` auto-routing
// convention here, so the API route is matched explicitly and everything else
// is handed to the static-assets binding, which serves ./dist.
import { handleFeedbackRequest } from './routes/feedback.js'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/feedback') return handleFeedbackRequest(request, env)
    return env.ASSETS.fetch(request)
  },
}
