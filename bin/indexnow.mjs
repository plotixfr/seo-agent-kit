/**
 * IndexNow: tell Bing, Yandex, Seznam, Naver and others that pages changed.
 * (Google does not use IndexNow; for Google submit the sitemap with bin/gsc.mjs submit.)
 *
 *   node bin/indexnow.mjs [--site name]              every URL in the sitemap
 *   node bin/indexnow.mjs [--site name] /path …      only these pages
 *
 * Setup: pick a key (8-128 hex chars), serve it as https://your-site/<key>.txt containing the
 * key itself, and put it in sites.json as "indexnowKey". The key is public by design.
 */
import { fail, parseArgs, pickSite, sitemapUrls } from "../lib/core.mjs";

const args = process.argv.slice(2);
const { flags, rest } = parseArgs(["_", ...args]);
const { site } = pickSite(flags);
const key = site.indexnowKey ?? fail("Set \"indexnowKey\" for this site in sites.json.");
const host = new URL(site.url).host;

const urls = rest.length
  ? rest.map((p) => new URL(p, site.url).toString())
  : await sitemapUrls(site.sitemap ?? new URL("/sitemap.xml", site.url).toString());

for (let i = 0; i < urls.length; i += 10000) {
  const urlList = urls.slice(i, i + 10000);
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
  });
  console.log(`IndexNow ${res.status} ${res.statusText} · ${urlList.length} URLs`);
  if (!res.ok) console.log(await res.text());
}
