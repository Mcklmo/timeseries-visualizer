// Emits the static landing pages, sitemap.xml and robots.txt into dist/.
//
// Runs *after* `vite build` (see package.json "build") for two reasons: it
// writes into dist/, which Vite empties on each build, and it links the CSS
// bundle Vite just produced. dist/ is gitignored, so nothing generated here is
// committed.
//
// Serving needs no routing change. Cloudflare's default assets
// `html_handling: "auto-trailing-slash"` serves dist/about.html at /about and
// redirects the .html form to it, and worker/index.js already hands every
// non-API request to env.ASSETS.fetch. Do NOT reach for
// `not_found_handling: "single-page-application"` — it would answer every
// typo'd URL with 200 + the app shell, which is a soft 404 at scale and a net
// SEO negative. Real 404s are correct and already work.
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRAND, SITE_URL, pages, prerenderedPages } from './seo/pages.mjs'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const OG_IMAGE = `${SITE_URL}/og.png`

// Vite content-hashes the bundle name on every build, so this has to be
// globbed rather than hardcoded — a stale hardcoded href would 404 silently
// and leave the landing pages unstyled.
function findStylesheet() {
  const assets = readdirSync(join(DIST, 'assets'))
  const css = assets.find((name) => name.startsWith('index-') && name.endsWith('.css'))
  if (!css) throw new Error('no dist/assets/index-*.css — run vite build first')
  return `/assets/${css}`
}

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A literal </script> inside a JSON-LD block ends the block early, whatever
// the JSON says. None of the current content contains one; this keeps that
// from becoming a silent trap for whoever edits pages.mjs next.
const jsonLd = (data) => JSON.stringify(data, null, 2).replace(/<\//g, '<\\/')

const BOLT_PATH =
  'M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z'

// Layout only. Colours, type and radii all come from the app's own tokens via
// the Vite bundle above, so these pages cannot drift from the product's look.
const PAGE_CSS = `
  .seo-page { max-width: 720px; margin: 0 auto; padding: 24px 24px 72px; }
  .seo-header { display: flex; align-items: center; justify-content: space-between; gap: 16px;
                padding: 16px 0 40px; }
  .seo-brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text);
               text-decoration: none; font-size: 17px; font-weight: 600; }
  .seo-brand svg { color: var(--metric-pace); }
  .seo-cta { color: var(--text); text-decoration: none; font-size: 14px; padding: 8px 16px;
             border: 1px solid var(--grid); border-radius: var(--radius); white-space: nowrap; }
  .seo-cta:hover { border-color: var(--metric-pace); }
  .seo-page h1 { font-size: 30px; line-height: 1.25; margin: 0 0 16px; letter-spacing: -0.4px; }
  .seo-page h2 { font-size: 19px; margin: 40px 0 12px; }
  .seo-page h3 { font-size: 16px; margin: 24px 0 8px; color: var(--text); }
  .seo-page p, .seo-page li { color: var(--text-dim); line-height: 1.65; }
  .seo-page p { margin: 0 0 16px; }
  .seo-page ul, .seo-page ol { margin: 0 0 16px; padding-left: 22px; }
  .seo-page li { margin-bottom: 8px; }
  .seo-page strong { color: var(--text); font-weight: 600; }
  .seo-page a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .seo-lead { font-size: 17px; color: var(--text) !important; }
  .seo-faq dt { font-weight: 600; color: var(--text); margin: 20px 0 6px; }
  .seo-faq dd { margin: 0; color: var(--text-dim); line-height: 1.65; }
  .seo-footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--grid);
                font-size: 14px; }
  .seo-footer ul { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; }
  @media (max-width: 600px) {
    .seo-page h1 { font-size: 25px; }
    .seo-header { padding-bottom: 28px; }
  }
`

function renderFaq(faq) {
  if (!faq) return ''
  const items = faq
    .map(({ q, a }) => `        <dt>${escapeHtml(q)}</dt>\n        <dd>${escapeHtml(a)}</dd>`)
    .join('\n')
  return `
      <h2>Questions</h2>
      <dl class="seo-faq">
${items}
      </dl>`
}

// Every page links to every other one. With no inbound links yet, internal
// linking is the only way a crawler reaches anything but "/".
function renderFooter(current) {
  const links = [
    { href: '/', label: 'Open the app' },
    ...prerenderedPages
      .filter((page) => page.slug !== current.slug)
      .map((page) => ({ href: `/${page.slug}`, label: page.heading })),
  ]
  return `
    <footer class="seo-footer">
      <ul>
${links.map((l) => `        <li><a href="${l.href}">${escapeHtml(l.label)}</a></li>`).join('\n')}
      </ul>
    </footer>`
}

function renderPage(page, stylesheet) {
  const url = `${SITE_URL}/${page.slug}`
  const structuredData = page.faq
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: page.faq.map(({ q, a }) => ({
            '@type': 'Question',
            name: q,
            acceptedAnswer: { '@type': 'Answer', text: a },
          })),
        },
      ]
    : []

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#12151a" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${BRAND}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <link rel="stylesheet" href="${stylesheet}" />
    <style>${PAGE_CSS}</style>
${structuredData
  .map((data) => `    <script type="application/ld+json">\n${jsonLd(data)}\n    </script>`)
  .join('\n')}
  </head>
  <body>
    <div class="seo-page">
      <header class="seo-header">
        <a class="seo-brand" href="/">
          <svg width="18" height="17" viewBox="0 0 48 46" fill="none" aria-hidden="true">
            <path fill="currentColor" d="${BOLT_PATH}" />
          </svg>
          ${BRAND}
        </a>
        <a class="seo-cta" href="/">Open a file →</a>
      </header>
      <main>
        <h1>${escapeHtml(page.heading)}</h1>
        <p class="seo-lead">${page.intro}</p>
${page.body.trimEnd()}
${renderFaq(page.faq)}
      </main>
${renderFooter(page)}
    </div>
  </body>
</html>
`
}

function renderSitemap() {
  const entries = pages
    .map(
      (page) => `  <url>
    <loc>${SITE_URL}/${page.slug}</loc>
    <priority>${page.slug === '' ? '1.0' : '0.8'}</priority>
  </url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`
}

// Generated from the same page list as the sitemap, so the two cannot drift.
const ROBOTS = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`

const stylesheet = findStylesheet()
const written = []

for (const page of prerenderedPages) {
  const file = `${page.slug}.html`
  writeFileSync(join(DIST, file), renderPage(page, stylesheet))
  written.push(file)
}
writeFileSync(join(DIST, 'sitemap.xml'), renderSitemap())
writeFileSync(join(DIST, 'robots.txt'), ROBOTS)
written.push('sitemap.xml', 'robots.txt')

console.log(`seo: ${SITE_URL} → ${written.join(', ')}`)
