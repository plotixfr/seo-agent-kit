/**
 * Google Search Console from the terminal.
 *
 *   node bin/gsc.mjs sites                          properties the service account can see
 *   node bin/gsc.mjs sitemaps                       submitted sitemaps: last read, errors
 *   node bin/gsc.mjs submit [sitemap-url]           (re)submit the sitemap (default: site.sitemap)
 *   node bin/gsc.mjs inspect <url|/path|@file> …    indexed? last crawl, canonical (2,000/day per property)
 *   node bin/gsc.mjs analytics [--days 28] [--dim query[,page,country,device,date]]
 *                              [--page /path] [--country deu] [--limit 25]
 *
 * Every command takes --site <name> (from sites.json) and --json.
 * Search data lags about 2 days; ranges end yesterday.
 */
import { readFileSync } from "node:fs";
import { day, fail, googleClient, out, pad, parseArgs, pickSite, readListFile } from "../lib/core.mjs";

const { cmd, rest, flags } = parseArgs();
if (!cmd) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ""));
  process.exit(0);
}
const { cfg, site } = pickSite(flags);
const api = googleClient(cfg, "https://www.googleapis.com/auth/webmasters");
const WM = "https://www.googleapis.com/webmasters/v3";
const enc = encodeURIComponent;
const prop = site.gsc ?? fail("Set \"gsc\" for this site in sites.json (sc-domain:example.com or https://www.example.com/).");
const absolute = (u) => (/^https?:\/\//.test(u) ? u : new URL(u, site.url).toString());

switch (cmd) {
  case "sites": {
    const list = (await api("GET", `${WM}/sites`)).siteEntry ?? [];
    out(flags, list, () => list.forEach((s) => console.log(`${s.siteUrl.padEnd(45)} ${s.permissionLevel}`)));
    break;
  }
  case "sitemaps": {
    const list = (await api("GET", `${WM}/sites/${enc(prop)}/sitemaps`)).sitemap ?? [];
    out(flags, list, () => {
      if (!list.length) console.log("No sitemaps submitted.");
      for (const m of list) {
        const n = (m.contents ?? []).map((c) => `${c.type} ${c.submitted}`).join(", ");
        console.log(`${m.path}\n  submitted ${m.lastSubmitted ?? "-"} · read ${m.lastDownloaded ?? "not yet"}${m.isPending ? " (pending)" : ""} · errors ${m.errors ?? 0} · warnings ${m.warnings ?? 0}${n ? ` · ${n}` : ""}`);
      }
    });
    break;
  }
  case "submit": {
    const feed = absolute(rest[0] ?? site.sitemap ?? "/sitemap.xml");
    await api("PUT", `${WM}/sites/${enc(prop)}/sitemaps/${enc(feed)}`);
    console.log(`Submitted ${feed} to ${prop}`);
    break;
  }
  case "inspect": {
    const urls = rest.flatMap((a) => (a.startsWith("@") ? readListFile(a) : [a])).map(absolute);
    if (!urls.length) fail("Usage: node bin/gsc.mjs inspect <url|/path|@file>");
    const results = [];
    for (const url of urls) {
      const r = (await api("POST", "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        { inspectionUrl: url, siteUrl: prop, languageCode: "en-US" })).inspectionResult;
      results.push({ url, ...r });
      if (flags.json) continue;
      const x = r.indexStatusResult ?? {};
      console.log(`\n${url}\n  ${x.verdict ?? "?"} · ${x.coverageState ?? "-"}`);
      console.log(`  last crawl ${x.lastCrawlTime ?? "never"} (${x.crawledAs ?? "-"}, fetch ${x.pageFetchState ?? "-"}, robots ${x.robotsTxtState ?? "-"})`);
      if (x.googleCanonical && x.googleCanonical !== x.userCanonical) console.log(`  canonical: yours ${x.userCanonical ?? "-"}, Google's ${x.googleCanonical}`);
    }
    if (flags.json) console.log(JSON.stringify(results, null, 2));
    break;
  }
  case "analytics": {
    const days = Number(flags.days ?? 28);
    const dim = flags.dim ?? "query";
    const filters = [
      ...(flags.page ? [{ dimension: "page", operator: "contains", expression: flags.page }] : []),
      ...(flags.country ? [{ dimension: "country", operator: "equals", expression: flags.country }] : []),
    ];
    const body = {
      startDate: day(days), endDate: day(1), dimensions: dim.split(","), rowLimit: Number(flags.limit ?? 25),
      ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
    };
    const rows = (await api("POST", `${WM}/sites/${enc(prop)}/searchAnalytics/query`, body)).rows ?? [];
    out(flags, rows, () => {
      console.log(`${prop} · ${body.startDate} to ${body.endDate} · by ${dim}`);
      console.log(`${pad("clicks", 7)} ${pad("impr", 7)} ${pad("CTR", 6)} ${pad("pos", 5)}  ${dim}`);
      for (const r of rows) console.log(`${pad(r.clicks, 7)} ${pad(r.impressions, 7)} ${pad((r.ctr * 100).toFixed(1), 5)}% ${pad(r.position.toFixed(1), 5)}  ${r.keys.join(" · ")}`);
    });
    break;
  }
  default:
    fail(`Unknown command "${cmd}". Run without arguments for help.`);
}
