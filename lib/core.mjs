// Shared helpers: config, CLI flags, Google service-account auth, output.
// Keys are only ever read from files outside the repo and never printed.
import { createSign } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const home = (p) => (p ? p.replace(/^~(?=\/)/, homedir()) : p);

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// node bin/x.mjs <cmd> [positional…] [--flag value] [--json]
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i];
    else rest.push(a);
  }
  return { cmd: rest[0], rest: rest.slice(1), flags };
}

export function loadConfig() {
  const file = home(process.env.SEO_KIT_CONFIG) ?? join(ROOT, "sites.json");
  if (!existsSync(file)) fail(`No config at ${file}. Copy sites.example.json to sites.json and fill it in.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

// --site <name>, else SEO_SITE, else the only/first site in sites.json.
export function pickSite(flags) {
  const cfg = loadConfig();
  const names = Object.keys(cfg.sites ?? {});
  const name = flags.site ?? process.env.SEO_SITE ?? names[0];
  const site = cfg.sites?.[name];
  if (!site) fail(`Unknown site "${name}". Sites in config: ${names.join(", ") || "none"}`);
  return { cfg, name, site };
}

// URL lists passed as @file must live inside the kit, so a command can never be pointed at key files.
export function readListFile(p) {
  // realpath on both sides, so a symlink inside the kit cannot point outside it.
  let full;
  try { full = realpathSync(resolve(p.replace(/^@/, ""))); } catch { fail(`No such list file: ${p}`); }
  const root = realpathSync(ROOT);
  if (!full.startsWith(root + sep)) fail(`List files must be inside ${root} (got ${full}).`);
  return readFileSync(full, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

export const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const out = (flags, data, human) => (flags.json ? console.log(JSON.stringify(data, null, 2)) : human(data));
export const pad = (v, n) => String(v).padStart(n);

const tokens = new Map();
async function googleToken(cfg, scope) {
  if (tokens.has(scope)) return tokens.get(scope);
  const file = home(process.env.GOOGLE_KEY_FILE ?? cfg.googleKeyFile);
  let key;
  try {
    key = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(`No service-account key at ${file} (or not valid JSON). See README, "Google access".`);
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const body = await res.json();
  if (!res.ok) fail(`Google refused the token: ${body.error_description ?? body.error ?? res.status}`);
  tokens.set(scope, body.access_token);
  return body.access_token;
}

export function googleClient(cfg, scope) {
  return async function api(method, url, body, { retries = 3 } = {}) {
    const token = await googleToken(cfg, scope);
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (res.ok) return data;
    const msg = data.error?.message ?? text;
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      await new Promise((r) => setTimeout(r, (4 - retries) * 5000));
      return api(method, url, body, { retries: retries - 1 });
    }
    if (res.status === 403 && /has not been used|is disabled/i.test(msg)) {
      fail(`This Google API is not enabled in your Cloud project. Enable it, wait a minute, retry.\n${msg}`);
    }
    if (res.status === 403) fail(`The service account has no access to this property. See README, "Google access".\n${msg}`);
    fail(`${method} ${url} → ${res.status}\n${msg}`);
  };
}

// Run fn over items with a fixed number of workers.
export async function pool(items, workers, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

// All <loc> URLs from a sitemap, following sitemap indexes.
export async function sitemapUrls(url, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  const res = await fetch(url, { headers: { "user-agent": "seo-agent-kit" } });
  if (!res.ok) fail(`Sitemap ${url} → ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (/<sitemapindex/i.test(xml)) {
    const nested = [];
    for (const loc of locs) nested.push(...(await sitemapUrls(loc, seen)));
    return nested;
  }
  return locs;
}
