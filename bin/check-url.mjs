/**
 * Read-only page check for agents (GET only, no request body, no local files).
 *
 *   node bin/check-url.mjs <url|/path> … [--site name] [--raw] [--json]
 *
 * Prints the redirect chain with status codes, X-Robots-Tag, and from the HTML: title,
 * meta robots, canonical, hreflang alternates, H1, JSON-LD @types and word count.
 * --raw prints the first 20 KB of the body instead (robots.txt, sitemap.xml).
 * Relative paths resolve against the site's url from sites.json.
 */
import { fail, out, parseArgs, pickSite } from "../lib/core.mjs";

const { flags, rest } = parseArgs(["_", ...process.argv.slice(2)]);
if (!rest.length) fail("Usage: node bin/check-url.mjs <url|/path> … [--raw]");
const base = rest.every((u) => /^https?:\/\//.test(u)) ? null : pickSite(flags).site.url;

async function check(input) {
  let url = new URL(input, base ?? undefined).toString();
  if (!/^https?:$/.test(new URL(url).protocol)) return { input, error: "only http(s) URLs" };
  const chain = [];
  let res;
  for (let hop = 0; hop < 10; hop++) {
    res = await fetch(url, { method: "GET", redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; seo-agent-kit)" } });
    chain.push({ status: res.status, url });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
    break;
  }
  const body = await res.text();
  if (flags.raw) return { input, chain, body: body.slice(0, 20000) };
  const head = body.split(/<\/head>/i)[0];
  const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`, "i")) ?? [])[1];
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return {
    input, chain, final: url, status: res.status,
    xRobotsTag: res.headers.get("x-robots-tag"),
    title: (head.match(/<title[^>]*>([^<]*)<\/title>/i) ?? [])[1]?.trim(),
    metaRobots: attr((head.match(/<meta[^>]+name="robots"[^>]*>/i) ?? [""])[0], "content"),
    canonical: attr(links.find((l) => /rel="canonical"/i.test(l)) ?? "", "href"),
    hreflang: links.filter((l) => /rel="alternate"/i.test(l) && /hreflang=/i.test(l)).map((l) => `${attr(l, "hreflang")} ${attr(l, "href")}`),
    h1: [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()),
    schemaTypes: [...new Set([...body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))],
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

const results = [];
for (const u of rest) results.push(await check(u).catch((e) => ({ input: u, error: String(e.message ?? e) })));
out(flags, results, () => results.forEach((r) => {
  if (r.error) return console.log(`${r.input}  ERROR ${r.error}`);
  console.log(r.chain.map((c) => `${c.status} ${c.url}`).join("\n  → "));
  if (flags.raw) return console.log(r.body);
  console.log(`  title: ${r.title ?? "-"}\n  robots: ${r.metaRobots ?? "-"}${r.xRobotsTag ? ` · X-Robots-Tag: ${r.xRobotsTag}` : ""}\n  canonical: ${r.canonical ?? "-"}`);
  console.log(`  hreflang (${r.hreflang.length}): ${r.hreflang.join(" | ") || "-"}\n  h1: ${r.h1.join(" | ") || "-"}\n  schema: ${r.schemaTypes.join(", ") || "-"} · words: ${r.words}\n`);
}));
