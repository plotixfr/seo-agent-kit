/**
 * Bing Webmaster Tools from the terminal.
 *
 *   node bin/bing.mjs traffic [--days 14]     clicks and impressions per day
 *   node bin/bing.mjs crawl [--days 14]       pages in index, crawled, errors, inbound links per day
 *   node bin/bing.mjs queries [--limit 25]    top queries
 *   node bin/bing.mjs submit-sitemap          (re)submit the sitemap
 *
 * API key: Bing Webmaster Tools → Settings → API access. Store it in the file named by
 * "bingKeyFile" in sites.json. Bing data lags several days; crawl stats can freeze for a week.
 */
import { readFileSync } from "node:fs";
import { fail, home, out, pad, parseArgs, pickSite } from "../lib/core.mjs";

const { cmd, flags } = parseArgs();
if (!cmd) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ""));
  process.exit(0);
}
const { cfg, site } = pickSite(flags);
let key;
try { key = readFileSync(home(process.env.BING_KEY_FILE ?? cfg.bingKeyFile), "utf8").trim(); } catch { fail("No Bing API key file. See README, \"Bing access\"."); }
const siteUrl = flags["site-url"] ?? site.bing ?? `${new URL(site.url).origin}/`;
const BASE = "https://ssl.bing.com/webmaster/api.svc/json";

async function call(method, params = {}, body) {
  const qs = new URLSearchParams({ apikey: key, ...(body ? {} : { siteUrl }), ...params });
  const res = await fetch(`${BASE}/${method}?${qs}`, body
    ? { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) }
    : {});
  const text = await res.text();
  if (!res.ok) fail(`Bing ${method} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text).d : null;
}
const date = (s) => new Date(Number(/\d+/.exec(s)[0])).toISOString().slice(0, 10);
const days = Number(flags.days ?? 14);

switch (cmd) {
  case "traffic": {
    const rows = ((await call("GetRankAndTrafficStats")) ?? []).map((r) => ({ date: date(r.Date), clicks: r.Clicks, impressions: r.Impressions })).slice(-days);
    out(flags, rows, () => rows.forEach((r) => console.log(`${r.date}  ${pad(r.clicks, 5)} clicks  ${pad(r.impressions, 6)} impr`)));
    break;
  }
  case "crawl": {
    const rows = ((await call("GetCrawlStats")) ?? []).map((r) => ({
      date: date(r.Date), inIndex: r.InIndex, crawled: r.CrawledPages, errors: r.CrawlErrors, inLinks: r.InLinks,
      ok: r.Code2xx, notFound: r.Code4xx, serverErrors: r.Code5xx, blockedByRobots: r.BlockedByRobotsTxt,
    })).slice(-days);
    out(flags, rows, () => {
      console.log(`${"date".padEnd(10)} ${pad("index", 6)} ${pad("crawl", 6)} ${pad("err", 4)} ${pad("4xx", 4)} ${pad("5xx", 4)} ${pad("inlinks", 8)}`);
      rows.forEach((r) => console.log(`${r.date} ${pad(r.inIndex, 6)} ${pad(r.crawled, 6)} ${pad(r.errors, 4)} ${pad(r.notFound, 4)} ${pad(r.serverErrors, 4)} ${pad(r.inLinks, 8)}`));
    });
    break;
  }
  case "queries": {
    const rows = ((await call("GetQueryStats")) ?? []).map((r) => ({ query: r.Query, clicks: r.Clicks, impressions: r.Impressions, position: r.AvgImpressionPosition }))
      .sort((a, b) => b.impressions - a.impressions).slice(0, Number(flags.limit ?? 25));
    out(flags, rows, () => rows.forEach((r) => console.log(`${pad(r.clicks, 5)} ${pad(r.impressions, 6)} pos ${pad(r.position, 4)}  ${r.query}`)));
    break;
  }
  case "submit-sitemap": {
    // POST methods take their arguments in the JSON body, not the query string.
    await call("SubmitFeed", {}, { siteUrl, feedUrl: site.sitemap ?? new URL("/sitemap.xml", site.url).toString() });
    console.log(`Submitted sitemap for ${siteUrl}`);
    break;
  }
  default:
    fail(`Unknown command "${cmd}". Run without arguments for help.`);
}
