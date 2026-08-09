// The basemaps the map panel can draw under the route. Mirrors
// metrics/metricRegistry.js's shape and serves the same purpose: adding
// satellite imagery later is one object here plus one entry in the Worker's
// allowlist, and no UI component hardcodes a basemap id.
//
// ⚠️ **THE UPSTREAM TILE URL IS NOT IN THIS FILE, AND MUST NOT BE ADDED.** The
// client asks its own origin for `/api/tiles/{id}/{z}/{x}/{y}.png` and the
// Worker owns the provider table (worker/routes/tiles.js). Two consequences,
// both deliberate:
//
//  · The proxy cannot be repointed at an arbitrary host by editing the bundle,
//    because the bundle never names a host.
//  · The tile provider never sees the athlete's IP address, which is the entire
//    reason the tiles are proxied rather than fetched directly. A map that
//    leaked "this person is looking at these coordinates" to a third party
//    would undo the privacy claim the rest of the app is built on.
//
// **`'none'` is a real entry, not the absence of one.** It is the DEFAULT: a
// freshly loaded activity makes zero network requests, which is what keeps
// App.test.jsx's no-fetch assertion passing unchanged and what turns that test
// into the mechanical guarantee that the default never silently flips.

/**
 * @typedef {object} Basemap
 * @property {string} id
 * @property {string} label - what the control says
 * @property {boolean} tiles - whether choosing this entry fetches anything at
 *   all. An explicit field rather than `id === 'none'` at the use sites: no UI
 *   component may hardcode a registry id (§6), and inferring it from a null
 *   attribution would make a legal obligation load-bearing for control flow.
 * @property {number} maxZoom - the deepest z the provider serves; the Worker
 *   validates against its own copy, this one only keeps the client from asking
 * @property {number} tileSize - CSS pixels per tile edge
 * @property {string|null} attribution - **legally required** whenever tiles are
 *   on screen. Rendered in the panel, not optional and not collapsible.
 */

/** @type {Record<string, Basemap>} */
export const basemapRegistry = {
  none: {
    id: 'none',
    label: 'None',
    tiles: false,
    maxZoom: 0,
    tileSize: 256,
    // Nothing is fetched and nothing is displayed, so there is nobody to credit.
    attribution: null,
  },
  standard: {
    id: 'standard',
    label: 'Map',
    tiles: true,
    maxZoom: 19,
    tileSize: 256,
    attribution: '© OpenStreetMap contributors, © CARTO',
  },
}

/** Canonical order, the way the control lists them. */
export const basemapOrder = ['none', 'standard']

/** The one that ships on. See the header — this being 'none' is a product
 *  commitment, not a default someone picked. */
export const DEFAULT_BASEMAP = 'none'

/** @param {unknown} id @returns {boolean} */
export function isKnownBasemap(id) {
  return typeof id === 'string' && Object.hasOwn(basemapRegistry, id)
}
