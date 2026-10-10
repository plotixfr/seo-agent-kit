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
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { fail, out, parseArgs, pickSite } from "../lib/core.mjs";

// Public internet only. The check runs inside the socket's DNS lookup, so the address that is
// validated is the address that is connected to (no gap for DNS rebinding), on every redirect hop.
// IPv4: everything except private, loopback, link-local (cloud metadata), CGNAT, test and reserved
// ranges. IPv6: only global unicast 2000::/3, minus documentation, Teredo and 6to4 (which can
// wrap private IPv4). IPv4-mapped/compatible IPv6 forms fall outside 2000::/3 and are refused.
const blocked4 = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]]) blocked4.addSubnet(net, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const blocked6 = new BlockList();
for (const [net, bits] of [["2001::", 32], ["2001:db8::", 32], ["2002::", 16]]) blocked6.addSubnet(net, bits, "ipv6");

function isPublic(ip) {
  const v = isIP(ip);
  if (v === 4) return !blocked4.check(ip, "ipv4");
  if (v === 6) return global6.check(ip, "ipv6") && !blocked6.check(ip, "ipv6");
  return false;
}

function safeLookup(hostname, options, cb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => !isPublic(a.address));
    if (bad || !addrs.length) return cb(new Error(`refusing non-public address ${bad?.address ?? "(none)"} for ${hostname}`));
    if (options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return reject(new Error("only http(s) URLs"));
    if (u.port && !["80", "443"].includes(u.port)) return reject(new Error("only ports 80 and 443"));
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublic(host)) return reject(new Error(`refusing non-public address ${host}`));
    const req = (u.protocol === "https:" ? https : http).get(url, {
      lookup: safeLookup, timeout: 15000, headers: { "user-agent": "Mozilla/5.0 (compatible; seo-agent-kit)" },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => { size += c.length; if (size <= 3e6) chunks.push(c); else res.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("close", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout after 15 s")));
    req.on("error", reject);
  });
}

const { flags, rest } = parseArgs(["_", ...process.argv.slice(2)]);
if (!rest.length) fail("Usage: node bin/check-url.mjs <url|/path> … [--raw]");
const base = rest.every((u) => /^https?:\/\//.test(u)) ? null : pickSite(flags).site.url;

async function check(input) {
  let url = new URL(input, base ?? undefined).toString();
  const chain = [];
  let res;
  for (let hop = 0; hop < 10; hop++) {
    res = await get(url);
    chain.push({ status: res.status, url });
    const loc = res.headers.location;
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
    break;
  }
  const { body } = res;
  if (flags.raw) return { input, chain, body: body.slice(0, 20000) };
  const head = body.split(/<\/head>/i)[0];
  const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`, "i")) ?? [])[1];
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return {
    input, chain, final: url, status: res.status,
    xRobotsTag: res.headers["x-robots-tag"] ?? null,
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
