/**
 * Cookieless visits from Vercel Web Analytics, to check what GA4 cannot see.
 *
 *   node bin/vercel-visits.mjs [--site name] [--hours 24 | --since ISO --until ISO]
 *                              [--by referrerHostname|country|requestPath|deviceType|hour]
 *                              [--filter "referrerHostname eq 'instagram.com'"]
 *
 * Typical use: compare paid clicks in an ad manager with real arrivals here, by country.
 * Vercel counts bots that run JavaScript too (ad-review crawlers from Meta show up as
 * US/IE/SE visitors with facebook referrers and one pageview).
 * Token: the Vercel CLI token (vercel login) or any token with read access, in "vercelTokenFile".
 */
import { readFileSync } from "node:fs";
import { fail, home, out, pad, parseArgs, pickSite } from "../lib/core.mjs";

const { flags } = parseArgs(["_", ...process.argv.slice(2)]);
const { cfg, site } = pickSite(flags);
const v = site.vercel ?? fail("Set \"vercel\": { projectId, teamId } for this site in sites.json.");
let token;
try {
  const raw = readFileSync(home(process.env.VERCEL_TOKEN_FILE ?? cfg.vercelTokenFile), "utf8").trim();
  token = raw.startsWith("{") ? JSON.parse(raw).token : raw;
} catch { fail("No Vercel token file. See README."); }

const until = flags.until ?? new Date().toISOString();
const since = flags.since ?? new Date(Date.now() - Number(flags.hours ?? 24) * 36e5).toISOString();
const by = flags.by ?? "referrerHostname";
const qs = new URLSearchParams({ projectId: v.projectId, teamId: v.teamId, since, until, by, ...(flags.filter ? { filter: flags.filter } : {}) });
const res = await fetch(`https://api.vercel.com/v1/query/web-analytics/visits/aggregate?${qs}`, { headers: { authorization: `Bearer ${token}` } });
const body = await res.json();
if (!res.ok) fail(`Vercel → ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 300)} (expired token? run vercel login)`);
out(flags, body.data, (rows) => {
  console.log(`${since} to ${until} · by ${by}${flags.filter ? ` · ${flags.filter}` : ""}\n${pad("visitors", 9)} ${pad("views", 6)}`);
  rows.forEach((r) => console.log(`${pad(r.visitors, 9)} ${pad(r.pageviews, 6)}  ${r[by] || "(none)"}`));
});
