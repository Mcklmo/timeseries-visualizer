// The closed vocabulary of anonymous usage counting — both sides import it, so
// the browser cannot send a feature the Worker does not know and the Worker
// cannot accept one the browser never sends. Values-only, like
// feedbackLimits.js: no DOM, no Workers globals.
//
// **What a feature id may say, and the rule every addition must pass.** Each id
// is a yes/no fact about *this page load* — "a .fit file was opened", "the
// charts were zoomed" — and nothing else: never a count, a duration, a value
// read from an activity, a filename or an account id. An id that could
// distinguish one visitor from another (a sport profile name, a date, a
// country of a route) does not belong here. The allowlist is what makes that a
// rule rather than a convention: the Worker drops anything not in it.
//
// Dependency rule (ARCHITECTURE.md §3): worker/ and src/ may each import from
// shared/; neither may import from the other.

export const USAGE_API_PATH = '/api/usage'

export const USAGE_FEATURES = Object.freeze([
  // How an activity got here. One per successful load route.
  'load:file',
  'load:intervals',
  'load:strava',
  'load:shared',
  'load:error',
  // Which parser a dropped file needed — the "can I stop maintaining the TCX
  // path?" question. 'sniffed' is a file whose name said nothing useful.
  'format:fit',
  'format:tcx',
  'format:gpx',
  'format:sniffed',
  'sport:running',
  'sport:cycling',
  'sport:track',
  // What was done with it once it was on screen.
  'zoom',
  'xaxis:distance',
  'metric:toggle',
  'stats',
  'derivative',
  'map:hidden',
  'basemap',
  'export',
  'share',
  'feedback:open',
])

const FEATURE_SET = new Set(USAGE_FEATURES)

/** @param {unknown} id */
export function isUsageFeature(id) {
  return typeof id === 'string' && FEATURE_SET.has(id)
}

// Wire shape: `{"v":1,"f":["load:file","zoom"]}`. The cap is the allowlist's
// own size — a page load cannot honestly have used more features than exist.
export const USAGE_PAYLOAD_VERSION = 1
export const USAGE_MAX_BODY_BYTES = 2048
