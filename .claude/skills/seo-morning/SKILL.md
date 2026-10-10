---
name: seo-morning
description: Five-minute morning SEO check for one site (traffic drop, index loss, crawl errors, ad traffic reality check). Speaks up only when something is wrong. Use when the user types /seo-morning <site>.
---

For site `$ARGUMENTS`, from the kit root, run and read:
1. `node bin/gsc.mjs analytics --site <site> --days 10 --dim date` — any day < 60% of the 7-day average?
2. `node bin/ga4.mjs compare --site <site> --days 7` and `node bin/ga4.mjs today --site <site>`
3. `node bin/bing.mjs crawl --site <site> --days 3` — errors, 5xx, InIndex drop?
4. If `vercel` is configured: `node bin/vercel-visits.mjs --site <site> --hours 24 --by referrerHostname` — paid traffic arriving at all?
5. `node bin/index-check.mjs --site <site> --only-not-indexed --limit 50` on Mondays and Thursdays.

Exclude known bot noise (see the seo-analyst agent). Reply in the report language from client.md, in at most 8 lines: "all normal" plus the 3 key numbers, or the problem with evidence and the one action you suggest. Append one line to `clients/<site>/log.jsonl` (type "result").
