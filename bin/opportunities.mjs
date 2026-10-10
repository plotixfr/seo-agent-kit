/**
 * Opportunities: the Search Console analysis worth doing every week, in one command.
 *
 *   node bin/opportunities.mjs [--site name] [--days 28] [--min 20] [--json]
 *
 * 1. Striking distance: queries at position 4-20 with impressions. Improving the page that
 *    already ranks is usually the fastest win.
 * 2. Low CTR: page 1 rankings that get clearly fewer clicks than your own site's average for
 *    that position. Fix the title and description.
 * 3. Cannibalization: one query, two or more of your pages splitting the impressions.
 * 4. Falling pages: pages that lost 30%+ impressions against the previous period.
 *
 * Everything is measured against your own site, not against industry CTR curves.
 */
import { day, googleClient, out, parseArgs, pickSite } from "../lib/core.mjs";

const { flags } = parseArgs(["_", ...process.argv.slice(2)]);
const { cfg, name, site } = pickSite(flags);
const api = googleClient(cfg, "https://www.googleapis.com/auth/webmasters.readonly");
const days = Number(flags.days ?? 28);
const min = Number(flags.min ?? 20);
const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.gsc)}/searchAnalytics/query`;

async function rows(dimensions, from, to) {
  const all = [];
  for (let startRow = 0; ; startRow += 25000) {
    const r = (await api("POST", url, { startDate: day(from), endDate: day(to), dimensions, rowLimit: 25000, startRow })).rows ?? [];
    all.push(...r);
    if (r.length < 25000) return all;
  }
}

const [qp, pagesNow, pagesBefore] = await Promise.all([
  rows(["query", "page"], days, 1),
  rows(["page"], days, 1),
  rows(["page"], days * 2, days + 1),
]);

// Your own CTR by rounded position, for positions 1-10.
const bucket = (p) => Math.min(10, Math.max(1, Math.round(p)));
const ctrBy = new Map();
for (const r of qp) {
  if (r.position > 10.5) continue;
  const b = ctrBy.get(bucket(r.position)) ?? { c: 0, i: 0 };
  b.c += r.clicks; b.i += r.impressions;
  ctrBy.set(bucket(r.position), b);
}
const expected = (p) => { const b = ctrBy.get(bucket(p)); return b && b.i >= 100 ? b.c / b.i : null; };

const striking = qp.filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= min)
  .sort((a, b) => b.impressions - a.impressions).slice(0, 30);

const lowCtr = qp.filter((r) => r.position <= 5 && r.impressions >= Math.max(min, 50))
  .map((r) => ({ ...r, expected: expected(r.position) }))
  .filter((r) => r.expected && r.ctr < r.expected * 0.5)
  .sort((a, b) => b.impressions - a.impressions).slice(0, 20);

const byQuery = new Map();
for (const r of qp) byQuery.set(r.keys[0], [...(byQuery.get(r.keys[0]) ?? []), r]);
const cannibal = [...byQuery].map(([query, list]) => {
  const total = list.reduce((s, r) => s + r.impressions, 0);
  const pages = list.filter((r) => r.impressions / total >= 0.1);
  return { query, total, pages };
}).filter((x) => x.total >= min && x.pages.length >= 2).sort((a, b) => b.total - a.total).slice(0, 20);

const before = new Map(pagesBefore.map((r) => [r.keys[0], r]));
const falling = pagesNow.map((r) => ({ page: r.keys[0], now: r.impressions, before: before.get(r.keys[0])?.impressions ?? 0 }))
  .concat(pagesBefore.filter((r) => !pagesNow.some((n) => n.keys[0] === r.keys[0])).map((r) => ({ page: r.keys[0], now: 0, before: r.impressions })))
  .filter((x) => x.before >= 100 && x.now < x.before * 0.7)
  .sort((a, b) => (b.before - b.now) - (a.before - a.now)).slice(0, 20);

const result = { site: name, property: site.gsc, from: day(days), to: day(1), striking, lowCtr, cannibal, falling };
out(flags, result, () => {
  const f = (r) => `${String(r.impressions).padStart(6)} impr  pos ${r.position.toFixed(1).padStart(4)}  ctr ${(r.ctr * 100).toFixed(1).padStart(4)}%  "${r.keys[0]}"  →  ${r.keys[1]}`;
  console.log(`${name} · ${site.gsc} · ${result.from} to ${result.to}\n`);
  console.log(`1. Striking distance (pos 4-20, ≥${min} impressions): ${striking.length}`);
  striking.forEach((r) => console.log(`   ${f(r)}`));
  console.log(`\n2. Low CTR on page 1 (under half of your own average at that position): ${lowCtr.length}`);
  lowCtr.forEach((r) => console.log(`   ${f(r)}  (yours at this position: ${(r.expected * 100).toFixed(1)}%)`));
  console.log(`\n3. Cannibalization (2+ pages with ≥10% of a query's impressions): ${cannibal.length}`);
  cannibal.forEach((c) => console.log(`   "${c.query}" ${c.total} impr: ${c.pages.map((p) => `${p.keys[1]} (${p.impressions}, pos ${p.position.toFixed(1)})`).join(" | ")}`));
  console.log(`\n4. Falling pages (-30% impressions vs previous ${days} days, ≥100 before): ${falling.length}`);
  falling.forEach((x) => console.log(`   ${String(x.before).padStart(6)} → ${String(x.now).padEnd(6)} ${x.page}`));
});
