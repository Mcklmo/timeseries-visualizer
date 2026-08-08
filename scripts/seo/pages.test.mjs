import { describe, it, expect } from 'vitest'
import { SITE_URL, pages, prerenderedPages } from './pages.mjs'

const wordCount = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/).length

describe('SEO page content model', () => {
  // The rule the whole of Phase 3 rides on. Five pages differing only in a
  // filename are doorway pages: they get algorithmically filtered, and the
  // site ends up worse off than if it had shipped one good page. 400 words is
  // the floor at which a page can plausibly say something the others don't.
  it('gives every prerendered page at least 400 words of body copy', () => {
    for (const page of prerenderedPages) {
      expect(wordCount(page.body), `/${page.slug} body`).toBeGreaterThanOrEqual(400)
    }
  })

  // Word count alone can't catch boilerplate, but near-duplicate copy can be
  // caught mechanically: if two pages share most of their vocabulary, they are
  // the same page with the filenames swapped.
  it('keeps the pages lexically distinct from one another', () => {
    const vocab = (page) =>
      new Set(
        page.body
          .replace(/<[^>]+>/g, ' ')
          .toLowerCase()
          .match(/[a-z]{5,}/g),
      )

    for (const a of prerenderedPages) {
      for (const b of prerenderedPages) {
        if (a.slug >= b.slug) continue
        const wordsA = vocab(a)
        const wordsB = vocab(b)
        const shared = [...wordsA].filter((word) => wordsB.has(word)).length
        const jaccard = shared / (wordsA.size + wordsB.size - shared)
        expect(jaccard, `/${a.slug} vs /${b.slug} vocabulary overlap`).toBeLessThan(0.4)
      }
    }
  })

  it('gives every page a unique slug and a title that survives the SERP truncation', () => {
    const slugs = pages.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)

    for (const page of pages) {
      // ~60 chars is where Google starts truncating a title, and ~160 a
      // description. Over the line is not fatal, but it means the tail is
      // being written for nobody.
      expect(page.title.length).toBeLessThanOrEqual(62)
      expect(page.description.length).toBeGreaterThan(110)
      expect(page.description.length).toBeLessThanOrEqual(165)
    }
  })

  it('leads with the privacy claim on the pages that target it', () => {
    const about = pages.find((page) => page.slug === 'about')
    expect(about.intro).toMatch(/never sent to a server/i)
    // The claim stops being an absolute somewhere on the page: two opt-in
    // features do reach the network, and a reader who used one must not feel
    // the page misled them.
    expect(about.body).toMatch(/only when you ask them to/i)
    expect(about.body).toMatch(/GitHub as a public issue/i)
    expect(about.body).toMatch(/never pass through this app's server/i)
  })

  it('answers FAQ entries in plain text, since they are reused verbatim as JSON-LD', () => {
    for (const page of prerenderedPages.filter((p) => p.faq)) {
      for (const { q, a } of page.faq) {
        expect(q).not.toMatch(/[<>]/)
        expect(a).not.toMatch(/[<>]/)
        expect(q.endsWith('?')).toBe(true)
      }
    }
  })

  it('canonicalises to the apex, with no trailing slash to double up on', () => {
    expect(SITE_URL).toBe('https://activitymaxxer.com')
  })
})
