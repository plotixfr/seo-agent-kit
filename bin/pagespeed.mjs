/**
 * Core Web Vitals from PageSpeed Insights (field data from CrUX when Google has it, plus lab).
 *
 *   node bin/pagespeed.mjs [--site name] <url|/path> … [--strategy mobile|desktop] [--json]
 *
 * Needs a free API key (Google Cloud → enable "PageSpeed Insights API" → Credentials → API key)
 * saved in the file named by "pagespeedKeyFile" in sites.json. Without a key Google answers 429.
 */
import { readFileSync } from "node:fs";
import { fail, home, out, parseArgs, pickSite } from "../lib/core.mjs";

const { flags, rest } = parseArgs(["_", ...process.argv.slice(2)]);
const { cfg, site } = pickSite(flags);
let key;
try { key = readFileSync(home(process.env.PAGESPEED_KEY_FILE ?? cfg.pagespeedKeyFile), "utf8").trim(); } catch { fail("No PageSpeed key file. See README."); }
if (!rest.length) fail("Usage: node bin/pagespeed.mjs <url|/path> …");
const strategy = flags.strategy ?? "mobile";
const results = [];
for (const u of rest) {
  const url = new URL(u, site.url).toString();
  const qs = new URLSearchParams({ url, strategy, key, category: "performance" });
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
  const d = await res.json();
  if (!res.ok) { results.push({ url, error: `${res.status} ${d.error?.message ?? ""}`.trim() }); continue; }
  const f = d.loadingExperience?.metrics ?? {};
  const a = d.lighthouseResult?.audits ?? {};
  results.push({
    url, strategy,
    field: d.loadingExperience?.overall_category ? {
      lcp_ms: f.LARGEST_CONTENTFUL_PAINT_MS?.percentile, inp_ms: f.INTERACTION_TO_NEXT_PAINT?.percentile,
      cls: f.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile / 100, overall: d.loadingExperience.overall_category,
    } : null,
    lab: { score: Math.round((d.lighthouseResult?.categories?.performance?.score ?? 0) * 100), lcp: a["largest-contentful-paint"]?.displayValue, cls: a["cumulative-layout-shift"]?.displayValue, tbt: a["total-blocking-time"]?.displayValue },
  });
}
out(flags, results, () => results.forEach((r) => console.log(r.error ? `${r.url}  ERROR ${r.error}`
  : `${r.url} (${r.strategy})\n  field: ${r.field ? `LCP ${r.field.lcp_ms} ms · INP ${r.field.inp_ms} ms · CLS ${r.field.cls} · ${r.field.overall}` : "no CrUX data (too little traffic)"}\n  lab:   score ${r.lab.score} · LCP ${r.lab.lcp} · CLS ${r.lab.cls} · TBT ${r.lab.tbt}`)));
