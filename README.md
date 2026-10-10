# seo-agent-kit

Search Console, GA4, Bing and IndexNow from the terminal, plus a team of Claude Code agents that use them to run SEO for a site every week.

Zero dependencies (Node 20+). Read-only by default. Nothing goes live without a human "ok".

Built and used by [Unlockd](https://unlockd.art) on our own site and client sites.

## What's inside

| Script | What it answers |
|---|---|
| `bin/index-check.mjs` | Which pages in my sitemap has Google actually indexed, which does it ignore and why, what changed since last week? (URL Inspection API on every URL, CSV + diff) |
| `bin/opportunities.mjs` | Where are the fastest wins? Striking-distance queries (pos 4-20), page-1 results with low CTR against **your own** CTR curve, cannibalization, falling pages |
| `bin/gsc.mjs` | Sites, sitemaps, sitemap submit, URL inspection, search analytics by any dimension |
| `bin/ga4.mjs` | Week vs week, reports by source/landing page/country, events, today + realtime |
| `bin/bing.mjs` | Bing clicks/impressions, crawl and index stats, top queries, sitemap submit |
| `bin/indexnow.mjs` | Ping Bing, Yandex, Seznam, Naver about changed URLs (whole sitemap or specific paths) |
| `bin/pagespeed.mjs` | Core Web Vitals per URL: real-user field data (CrUX) when Google has it, plus a lab run |
| `bin/vercel-visits.mjs` | Cookieless visits (Vercel Web Analytics) to see what GA4 cannot: e.g. paid clicks vs real arrivals by country |

| Agent (`.claude/agents/`) | Job |
|---|---|
| `seo-analyst` | Runs the scripts, reports measured findings only |
| `seo-researcher` | Keyword demand per language and city, competitor gaps, briefs (works with a keyword MCP: Seobility, DataForSEO, Semrush, Ahrefs) |
| `seo-auditor` | Indexing, canonicals, hreflang, schema, mobile, Core Web Vitals. Never edits code |
| `seo-writer` | Drafts from the brief and real data only; missing numbers become `[NUMBER: …]` |
| `seo-fact-checker` | Re-checks every number, claim, link and client rule; sends objections back to the writer. Never rewrites |
| `seo-localizer` | Other languages with per-market keywords, slugs, hreflang; flags lines for native review |
| `seo-publisher` | Local commit or CMS draft after approval; after the human deploys: IndexNow, sitemaps, live checks, change log |

Skills: `/seo-week <site>` runs the whole cycle with you as the approver; `/seo-morning <site>` is a five-minute health check.

## How the agents talk

The main Claude Code session is the coordinator. It launches the analyst and auditor in parallel, gives the analyst's report to the researcher, writes a plan of at most 5 actions and stops for your approval. For each approved item the writer drafts, the fact-checker objects, and the coordinator sends the objections back to the **same** writer (so it keeps its context) until the draft passes or 3 rounds are used up. Every handoff, objection and decision is appended to `clients/<site>/log.jsonl`.

## Quick start

```bash
git clone https://github.com/plotixfr/seo-agent-kit && cd seo-agent-kit
cp sites.example.json sites.json        # fill in your site (sites.json is gitignored)
node bin/gsc.mjs sites                  # check Google access
node bin/opportunities.mjs              # this week's wins
node bin/index-check.mjs                # what Google really has
```

Then open Claude Code in this folder, copy `clients/_template` to `clients/<site>`, fill in `client.md`, and run `/seo-week <site>`.

Permissions: `.claude/settings.json` allows the read-only script commands, asks before anything that pings search engines, and denies `git push`. Claude Code ignores a project's permission rules until you have opened Claude Code interactively in the folder once and accepted the trust prompt, so do that before running headless (`claude -p "/seo-week <site>"`). Add your keyword MCP to `.claude/settings.local.json` (gitignored), for example `{"permissions":{"allow":["mcp__seobility-mcp"],"deny":["mcp__seobility-mcp__start_crawl"]}}`, and deny the tools that change your account.

## Google access (Search Console + GA4)

1. Google Cloud Console → new project → enable **Google Search Console API**, **Google Analytics Data API** and **Google Analytics Admin API**.
2. IAM → Service accounts → create one → Keys → add JSON key. Save it outside any repo (e.g. `~/.config/seo-agent-kit/google-key.json`, `chmod 600`). Some organizations block key creation by policy; then use a personal project.
3. Search Console → Settings → Users and permissions → add the service account email with **Full** permission (sitemap submit needs more than Restricted).
4. GA4 → Admin → Property access management → add the same email as **Viewer**. Put the numeric property ID in `sites.json`.

The URL Inspection API allows 2,000 checks per day per property and 600 per minute. "Request indexing" is not in the API; do that in the Search Console UI for the few pages that matter.

## Bing, IndexNow, Vercel

- Bing Webmaster Tools → Settings → API access → generate a key → save it to the file named in `bingKeyFile`.
- IndexNow: choose a key, serve `https://your-site/<key>.txt` containing the key, put it in `indexnowKey`. Google does not use IndexNow.
- Vercel Web Analytics: `vercel login`, then set `vercelTokenFile` and the project/team IDs.
- PageSpeed Insights (Core Web Vitals for the auditor): create a free API key in the same Google Cloud project (enable PageSpeed Insights API) save it in a file and point `"pagespeedKeyFile"` in `sites.json` at it. Without a key the API answers 429.

## Things we learned the hard way

- **GA4 is not your traffic.** It only counts visitors who accept cookies. On one paid campaign day we saw 19 real arrivals in cookieless analytics and 0 in GA4.
- **Ad clicks are not visits.** Compare ad-manager clicks with cookieless arrivals by country before you scale a country.
- **Ad-review bots look like visitors.** One-page, zero-second visits from US/IE/SE data-center cities with facebook referrers right after you publish an ad are the platform's crawlers.
- **Block your own analytics** and remember you did (a hosts-file block made our own visits invisible, and also made local tracking tests fail).
- **"Unknown to Google" after a URL migration** is normal for weeks: Google keeps the old URL until it recrawls the redirect.
- **One change at a time per page**, logged with a date, or you will never know what worked.

## Rules the agents follow

No invented numbers. No mass-generated pages (max 2 new posts per site per week). No bought links or link exchanges. Client rules in `client.md` override everything. Nothing is pushed, deployed or published by an agent.

## License

MIT
