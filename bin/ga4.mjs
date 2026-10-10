/**
 * Google Analytics 4 from the terminal (read-only).
 *
 *   node bin/ga4.mjs props                                   properties the service account can see
 *   node bin/ga4.mjs compare [--days 7]                      last N days vs the N before
 *   node bin/ga4.mjs report [--days 28] [--dim date|pagePath|landingPage|sessionSource|
 *                            sessionCampaignName|country|city|deviceCategory] [--limit 25]
 *   node bin/ga4.mjs events [--days 28]                      events (form submits, CTA clicks…)
 *   node bin/ga4.mjs today                                   today so far + realtime (last 30 min)
 *
 * GA4 only counts visitors who accept analytics cookies. In the EU that can be a small
 * share of real visitors, so compare with a cookieless source (bin/vercel-visits.mjs,
 * server logs) before you judge a campaign.
 */
import { readFileSync } from "node:fs";
import { day, fail, googleClient, out, pad, parseArgs, pickSite } from "../lib/core.mjs";

const { cmd, flags } = parseArgs();
if (!cmd) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ""));
  process.exit(0);
}
const { cfg, site } = pickSite(flags);
const api = googleClient(cfg, "https://www.googleapis.com/auth/analytics.readonly");
const DATA = "https://analyticsdata.googleapis.com/v1beta";
const prop = () => site.ga4 ?? fail("Set \"ga4\" (numeric property ID) for this site in sites.json.");
const run = (body, kind = "runReport") => api("POST", `${DATA}/properties/${prop()}:${kind}`, body);
const n = (r, i) => Number(r.metricValues[i].value);
const vals = (r) => r.dimensionValues.map((d) => d.value).join(" · ");

switch (cmd) {
  case "props": {
    const sums = (await api("GET", "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200")).accountSummaries ?? [];
    const list = sums.flatMap((a) => (a.propertySummaries ?? []).map((p) => ({ id: p.property.replace("properties/", ""), name: p.displayName, account: a.displayName })));
    out(flags, list, () => list.forEach((p) => console.log(`${p.id.padEnd(12)} ${p.name} (${p.account})`)));
    break;
  }
  case "compare": {
    const days = Number(flags.days ?? 7);
    const metrics = ["activeUsers", "newUsers", "sessions", "engagedSessions", "screenPageViews", "averageSessionDuration"];
    const win = (a, b) => run({ dateRanges: [{ startDate: day(a), endDate: day(b) }], metrics: metrics.map((name) => ({ name })) });
    const [now, before] = await Promise.all([win(days, 1), win(days * 2, days + 1)]);
    out(flags, { now, before }, () => {
      const A = now.rows?.[0], B = before.rows?.[0];
      if (!A || !B) return console.log("No data for this period.");
      console.log(`GA4 ${prop()} · ${day(days)} to ${day(1)} vs ${day(days * 2)} to ${day(days + 1)}\n`);
      metrics.forEach((m, i) => {
        const a = n(A, i), b = n(B, i);
        const ch = b === 0 ? "-" : `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(0)}%`;
        const f = (v) => (m === "averageSessionDuration" ? `${Math.round(v)}s` : Math.round(v));
        console.log(`${m.padEnd(24)}${pad(f(a), 8)}${pad(f(b), 8)}${pad(ch, 8)}`);
      });
    });
    break;
  }
  case "report": {
    const days = Number(flags.days ?? 28);
    const dim = flags.dim ?? "date";
    const data = await run({
      dateRanges: [{ startDate: day(days), endDate: day(1) }],
      dimensions: dim.split(",").map((name) => ({ name })),
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "engagedSessions" }, { name: "screenPageViews" }],
      orderBys: [dim === "date" ? { dimension: { dimensionName: "date" } } : { metric: { metricName: "sessions" }, desc: true }],
      limit: Number(flags.limit ?? 25),
    });
    out(flags, data.rows ?? [], (rows) => {
      console.log(`GA4 ${prop()} · ${day(days)} to ${day(1)} · by ${dim}\n${pad("users", 7)} ${pad("sess", 6)} ${pad("engaged", 8)} ${pad("views", 6)}  ${dim}`);
      rows.forEach((r) => console.log(`${pad(n(r, 0), 7)} ${pad(n(r, 1), 6)} ${pad(n(r, 2), 8)} ${pad(n(r, 3), 6)}  ${vals(r)}`));
    });
    break;
  }
  case "events": {
    const days = Number(flags.days ?? 28);
    const data = await run({
      dateRanges: [{ startDate: day(days), endDate: day(1) }],
      dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }], limit: Number(flags.limit ?? 40),
    });
    out(flags, data.rows ?? [], (rows) => {
      console.log(`GA4 ${prop()} · ${day(days)} to ${day(1)} · events\n${pad("count", 7)} ${pad("users", 6)}  event`);
      rows.forEach((r) => console.log(`${pad(n(r, 0), 7)} ${pad(n(r, 1), 6)}  ${vals(r)}`));
    });
    break;
  }
  case "today": {
    const [today, live] = await Promise.all([
      run({
        dateRanges: [{ startDate: "today", endDate: "today" }],
        dimensions: [{ name: "sessionSource" }, { name: "sessionCampaignName" }, { name: "country" }, { name: "city" }, { name: "landingPage" }],
        metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "screenPageViews" }], limit: 100,
      }),
      run({ dimensions: [{ name: "country" }, { name: "city" }], metrics: [{ name: "activeUsers" }] }, "runRealtimeReport"),
    ]);
    out(flags, { today, live }, () => {
      console.log(`Today so far (sessions / engaged / views):`);
      (today.rows ?? []).forEach((r) => console.log(`  ${n(r, 0)} / ${n(r, 1)} / ${n(r, 2)}  ${vals(r)}`));
      console.log(`\nRealtime, last 30 min:`);
      (live.rows ?? []).forEach((r) => console.log(`  ${n(r, 0)}  ${vals(r)}`));
      if (!today.rows?.length && !live.rows?.length) console.log("  nothing (GA4 also lags a few hours for today's data)");
    });
    break;
  }
  default:
    fail(`Unknown command "${cmd}". Run without arguments for help.`);
}
