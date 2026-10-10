/**
 * Index check: runs Google's URL Inspection on every URL in your sitemap and tells you
 * which pages Google actually has, which it ignores and why, and what changed since last run.
 *
 *   node bin/index-check.mjs [--site name] [--workers 5] [--limit N]
 *                            [--only-not-indexed]   re-check only pages not indexed last run (saves quota)
 *                            [--urls @file]         check these URLs instead of the sitemap
 *
 * Writes out/index-<site>-<date>.csv and prints a summary plus a diff against the previous run.
 * Quota: 2,000 inspections per day per property, 600 per minute. Keep --workers at 5 or less.
 * Speed: a 473-URL sitemap took a little over 10 minutes with 5 workers.
 *
 * The "unknown to Google" bucket ("URL is unknown to Google") is normal for new pages and for
 * pages Google still holds under an older URL. "Discovered - currently not indexed" usually
 * means weak internal links or thin/duplicate content, not a technical error.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, fail, googleClient, parseArgs, pickSite, pool, readListFile, sitemapUrls } from "../lib/core.mjs";

const { flags } = parseArgs(["_", ...process.argv.slice(2)]);
const { cfg, name, site } = pickSite(flags);
const api = googleClient(cfg, "https://www.googleapis.com/auth/webmasters");
const prop = site.gsc ?? fail("Set \"gsc\" for this site in sites.json.");
const OUT = join(ROOT, "out");
mkdirSync(OUT, { recursive: true });

const COLS = ["url", "verdict", "coverageState", "lastCrawlTime", "pageFetchState", "robotsTxtState", "indexingState", "userCanonical", "googleCanonical", "canonicalMismatch"];
const csvCell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const parseCsv = (text) => {
  const [head, ...lines] = text.trim().split("\n");
  const cols = head.split(",");
  return lines.map((line) => {
    const cells = [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"'));
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
};

const previousFile = readdirSync(OUT).filter((f) => f.startsWith(`index-${name}-`) && f.endsWith(".csv")).sort().at(-1);
const previous = previousFile ? parseCsv(readFileSync(join(OUT, previousFile), "utf8")) : [];
const prevBy = new Map(previous.map((r) => [r.url, r]));

let urls;
if (flags.urls) urls = readListFile(flags.urls);
else if (flags["only-not-indexed"]) {
  if (!previous.length) fail("No previous run to take not-indexed URLs from. Run once without --only-not-indexed.");
  urls = previous.filter((r) => r.verdict !== "PASS").map((r) => r.url);
} else urls = await sitemapUrls(site.sitemap ?? new URL("/sitemap.xml", site.url).toString());
urls = [...new Set(urls)].slice(0, Number(flags.limit ?? 2000));
console.log(`${name}: inspecting ${urls.length} URLs against ${prop} …`);

let done = 0;
const rows = await pool(urls, Number(flags.workers ?? 5), async (url) => {
  const r = (await api("POST", "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    { inspectionUrl: url, siteUrl: prop, languageCode: "en-US" })).inspectionResult?.indexStatusResult ?? {};
  if (++done % 50 === 0) console.log(`  ${done}/${urls.length}`);
  return {
    url, verdict: r.verdict, coverageState: r.coverageState, lastCrawlTime: r.lastCrawlTime,
    pageFetchState: r.pageFetchState, robotsTxtState: r.robotsTxtState, indexingState: r.indexingState,
    userCanonical: r.userCanonical, googleCanonical: r.googleCanonical,
    canonicalMismatch: r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical ? "yes" : "",
  };
});

// With --only-not-indexed, carry the other rows over so the file stays a full picture.
const merged = flags["only-not-indexed"]
  ? previous.map((p) => rows.find((r) => r.url === p.url) ?? p)
  : rows;
const file = join(OUT, `index-${name}-${new Date().toISOString().slice(0, 10)}.csv`);
writeFileSync(file, [COLS.join(","), ...merged.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n");

const count = (list, key) => list.reduce((m, r) => m.set(r[key] || "(none)", (m.get(r[key] || "(none)") ?? 0) + 1), new Map());
console.log(`\nCoverage (${merged.length} URLs):`);
for (const [state, n] of [...count(merged, "coverageState")].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${state}`);
const indexed = merged.filter((r) => r.verdict === "PASS").length;
console.log(`\nIndexed: ${indexed}/${merged.length} (${((indexed / merged.length) * 100).toFixed(1)}%)`);

const problems = merged.filter((r) => r.pageFetchState && !["SUCCESSFUL", "PAGE_FETCH_STATE_UNSPECIFIED"].includes(r.pageFetchState)
  || r.robotsTxtState === "DISALLOWED" || /noindex/i.test(r.indexingState ?? "") || r.canonicalMismatch === "yes");
if (problems.length) {
  console.log(`\nNeeds a look (${problems.length}): fetch errors, robots blocks, noindex, Google picked another canonical`);
  for (const r of problems.slice(0, 25)) console.log(`  ${r.url}  ${["SUCCESSFUL", "PAGE_FETCH_STATE_UNSPECIFIED"].includes(r.pageFetchState) ? "" : r.pageFetchState ?? ""} ${r.robotsTxtState === "DISALLOWED" ? "robots-blocked" : ""} ${/noindex/i.test(r.indexingState ?? "") ? r.indexingState : ""} ${r.canonicalMismatch ? `→ ${r.googleCanonical}` : ""}`.replace(/\s+$/, ""));
}

if (previous.length) {
  const gained = merged.filter((r) => r.verdict === "PASS" && prevBy.get(r.url)?.verdict && prevBy.get(r.url).verdict !== "PASS");
  const lost = merged.filter((r) => r.verdict !== "PASS" && prevBy.get(r.url)?.verdict === "PASS");
  const fresh = merged.filter((r) => !prevBy.has(r.url));
  console.log(`\nSince ${previousFile}: +${gained.length} newly indexed, -${lost.length} dropped out, ${fresh.length} new URLs in sitemap`);
  for (const r of lost.slice(0, 20)) console.log(`  dropped: ${r.url} (${r.coverageState})`);
}
console.log(`\nSaved ${file}`);
if (!existsSync(file)) fail("Could not write the CSV.");
