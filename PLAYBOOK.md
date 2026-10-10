# Google playbook: what moves a site, in order of impact

The agents work top-down and do not move to a lower level while a higher one has an open problem.
Google has to **see** the page, then **understand** it, then **choose** it, then someone has to **click** it.

## 1. Indexing (nothing else matters until this is fixed)

- Every important page: 200, `index,follow`, self-canonical, in the sitemap, at least 3 internal links from indexed pages.
- Run `bin/index-check.mjs` weekly. Buckets: indexed / discovered, not indexed / crawled, not indexed / unknown to Google.
- "Discovered, not indexed": stronger internal links from pages that are indexed, unique content. Do not re-request the same URL every day.
- Site killers we have seen on real sites: `noindex` left on every listing page, robots.txt blocking images or JS, canonicals pointing at the home page, 302 instead of 301 after a migration.
- After every deploy: IndexNow for changed URLs (`bin/indexnow.mjs`), sitemap resubmit to Google (`bin/gsc.mjs submit`) and Bing.

**Listing sites (real estate, jobs, products):** every listing indexable, with a unique title (type + place + size + price), a description that is not the portal copy, sold items kept with a "sold" label or 301 to the closest category (not mass 404s), filters and sorting not creating thousands of crawlable URLs.

## 2. Understanding (Google knows what the page is and who it is for)

- One main query per page. Two pages on one query = cannibalization (`bin/opportunities.mjs` lists them): merge or redirect one.
- Query in title (≤ 60 chars), H1, first paragraph and slug, naturally.
- Schema: Organization/LocalBusiness on home, RealEstateListing/Offer on listings, Service on services, Article + author on posts, FAQPage only where there are real questions, BreadcrumbList everywhere. Validate it.
- Multilingual: hreflang both ways + x-default, translated slugs, keywords researched per language (German searchers type "Webdesign Agentur", not a translation of your English keyword).
- Entity: same name, address and phone on the site, the Google Business Profile and directories.

## 3. Being chosen (Google picks you over a competitor)

Highest return on time:

1. **Queries at position 4-20 with impressions** (striking distance): improve the page that already ranks: a section that answers the query, an FAQ, internal links from strong pages. Measure after 28 days.
2. **Queries without a matching page**: impressions land on the wrong page → a dedicated page.
3. **Local pages**: city or neighborhood + service, with real local content, not a template with the city name swapped.
4. **Your own data** (information gain): measurements, prices, timelines, real examples. AI-written pages do not have them, which is why they get cited and linked.
5. **E-E-A-T**: a real author with a profile page, "updated" dates only when the text really changed, sources.
6. **Google Business Profile** (local businesses): categories, photos, a post a week, a reply to every review. Review count and freshness is the strongest local signal we see. The agent drafts, a human posts.
7. **Links**: digital PR with data, local media and associations. Footer credits on client sites with the brand name only. No link exchanges, no paid links.

## 4. The click

- Positions 1-5 with CTR well under your own average for that position: rewrite title and description with a concrete benefit, price or number.
- Rich results: FAQ, breadcrumbs, prices on listings, reviews where allowed.
- AI answers (AI Overviews, ChatGPT, Perplexity): open each section with a direct 2-3 sentence answer, then details; tables for prices and timelines.

## 5. Technical (always, in the background)

- Core Web Vitals on mobile: LCP < 2.5 s, INP < 200 ms, CLS < 0.1.
- No redirect chains, no internal links to 404s, images with alt text and the right size.
- JS frameworks: content present in the HTML, not only after hydration; cached pages not serving stale versions; cache revalidation not burning your hosting bill.

## What we do not do

- Mass-generated content (Google's scaled content abuse policy). Maximum 2 new posts per site per week.
- Invented numbers, fake reviews, hidden text, bought links, PBNs.
- Twenty changes at once: then nobody knows what worked. Maximum 5 actions per week, each logged in `changes.csv`.

## How we know it worked

- Every change: date + URL in `changes.csv`.
- After 28 days: Search Console for that URL, 28 days before vs 28 days after (impressions, clicks, position, CTR).
- Nobody touches the same page again for at least 3 weeks.
