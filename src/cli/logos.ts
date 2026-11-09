// The curated operators' names, 1P/3P and logos (targets/operators.json + web/public/logos/).
// Run at build time (after `npm run curate`); the page only ever reads the committed files, so a
// visitor never fetches a logo from another site.
//
// Same source as x402jp.com's "x402 Endpoint" section: kato9292929/endpoint's data/services.json
// (name, party, via, domain, category, logo) and its public/logos/ files. An operator that is not
// there gets its own domain's icon (apple-touch-icon first, then favicon), else an initials tile.
//   npm run logos
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, USER_AGENT } from "../config.js";
import type { CuratedFile } from "../curated/curate.js";
import { type OperatorMeta, type OfficialService, matchOfficial, registrable, slugOf } from "../curated/operators.js";

const RAW = process.env.ENDPOINT_RAW_BASE ?? "https://raw.githubusercontent.com/kato9292929/endpoint/main";
const OUT = resolve(ROOT, "web/public/logos");
const MAX_BYTES = 200 * 1024;
const EXT: Record<string, string> = {
  "image/png": "png", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/svg+xml": "svg",
  "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
};
// Best first: a touch icon is made to be seen at size, a favicon at 16px (same order as the endpoint repo).
const PATHS = ["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/icon.png", "/favicon.svg", "/favicon.png", "/favicon.ico"];

async function get(url: string): Promise<{ buf: Buffer; type: string } | null> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": USER_AGENT, accept: "image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    return { buf, type };
  } catch {
    return null;
  }
}

/** An image response worth keeping: a known image type (or .ico by magic bytes), not empty, not huge. */
function asImage(x: { buf: Buffer; type: string } | null, url: string): { buf: Buffer; ext: string } | null {
  if (!x || x.buf.length < 64 || x.buf.length > MAX_BYTES) return null;
  let ext = EXT[x.type];
  if (!ext && x.buf[0] === 0 && x.buf[1] === 0 && x.buf[2] === 1) ext = "ico";
  if (!ext && x.buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = "png";
  if (!ext && /\.svg$/i.test(url) && x.buf.toString("utf8", 0, 400).includes("<svg")) ext = "svg";
  return ext ? { buf: x.buf, ext } : null;
}

async function iconForHost(host: string): Promise<{ buf: Buffer; ext: string } | null> {
  for (const p of PATHS) {
    const img = asImage(await get(`https://${host}${p}`), p);
    if (img) return img;
  }
  // <link rel="icon" href=...> on the home page
  try {
    const r = await fetch(`https://${host}/`, { redirect: "follow", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 200_000);
    const links = [...html.matchAll(/<link[^>]+rel=["']?[^"'>]*icon[^"'>]*["']?[^>]*>/gi)].map((m) => m[0]);
    links.sort((a, b) => Number(/apple-touch/i.test(b)) - Number(/apple-touch/i.test(a)));
    for (const l of links) {
      const href = l.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href || href.startsWith("data:")) continue;
      const u = new URL(href, r.url).toString();
      const img = asImage(await get(u), u);
      if (img) return img;
    }
  } catch {
    /* no page */
  }
  return null;
}

const curated: CuratedFile = JSON.parse(readFileSync(resolve(ROOT, "targets/curated.json"), "utf8"));
const res = await fetch(`${RAW}/data/services.json`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`services.json: HTTP ${res.status}`);
const services: OfficialService[] = ((await res.json()) as { services: OfficialService[] }).services;

mkdirSync(OUT, { recursive: true });
const firstByOperator = new Map<string, CuratedFile["items"][number]>();
for (const i of curated.items) if (!firstByOperator.has(i.operator)) firstByOperator.set(i.operator, i);

const metas: OperatorMeta[] = [];
const keep = new Set<string>();
for (const [operator, item] of firstByOperator) {
  const hosts = [...new Set(curated.items.filter((i) => i.operator === operator).map((i) => i.host))];
  const svc = matchOfficial(hosts, services);
  const slug = svc?.slug ?? slugOf(hosts[0]);
  const base: Omit<OperatorMeta, "logo" | "logo_source"> = svc
    ? { operator, slug, name: svc.name, party: svc.party, via: svc.via ?? [], domain: svc.domain ?? registrable(hosts[0]), category: svc.category ?? item.category, official_slug: svc.slug }
    : { operator, slug, name: (item.name ?? item.operator_name).split(/ [—–|·-] /)[0].trim(), party: "1P", via: [], domain: registrable(hosts[0]), category: item.category, official_slug: null };
  let logo: string | null = null;
  let source: OperatorMeta["logo_source"] = "initials";
  // 1. the official site's logo (same file)
  if (svc?.logo) {
    const got = asImage(await get(`${RAW}/public${svc.logo}`), svc.logo);
    if (got) {
      logo = `${slug}.${got.ext}`;
      writeFileSync(resolve(OUT, logo), got.buf);
      source = "official";
    }
  }
  // 2. the operator's own domain (3P: the brand's domain, never the gateway's)
  if (!logo) {
    const tries = base.party === "3P" ? (base.domain ? [base.domain, `www.${base.domain}`] : []) : [...hosts.slice(0, 2), ...(base.domain ? [base.domain, `www.${base.domain}`] : [])];
    for (const h of [...new Set(tries)]) {
      const got = await iconForHost(h);
      if (got) {
        logo = `${slug}.${got.ext}`;
        writeFileSync(resolve(OUT, logo), got.buf);
        source = "domain";
        break;
      }
    }
  }
  if (logo) keep.add(logo);
  metas.push({ ...base, logo: logo ? `/logos/${logo}` : null, logo_source: source });
  console.log(`${hosts[0]}: ${base.name} [${base.party}] logo ${source}${logo ? ` ${logo}` : ""}`);
}
// Files of operators no longer curated are removed (the folder holds exactly the current set).
for (const f of readdirSync(OUT)) if (!keep.has(f)) unlinkSync(resolve(OUT, f));
writeFileSync(resolve(ROOT, "targets/operators.json"), JSON.stringify({ generated_at: new Date().toISOString(), source: `${RAW}/data/services.json`, operators: metas }, null, 1) + "\n");
const by = metas.reduce<Record<string, number>>((a, m) => ((a[m.logo_source] = (a[m.logo_source] ?? 0) + 1), a), {});
console.log(`operators: ${metas.length}; logos ${JSON.stringify(by)} → targets/operators.json, web/public/logos/`);
