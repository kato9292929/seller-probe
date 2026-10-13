// Reads the public x402 Endpoint catalog snapshot (kato9292929/endpoint, read-only)
// pinned to the commit it was read at, and picks probe targets from it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ENDPOINT_RAW, ENDPOINT_REPO, LIMITS, USER_AGENT } from "./config.js";

export type CatalogEndpoint = {
  id: string;
  url: string;
  name?: string;
  price?: { amount: number; currency: string; unit: string };
  networks: string[];
  protocols: string[];
  last_seen?: string;
};

export type Catalog = {
  source: { repo: string; commit: string | null; file: string; generated_at: string | null };
  endpoints: CatalogEndpoint[];
};

export type Target = {
  host: string;
  url: string;
  endpoint_id: string;
  price_usd: number;
  networks: string[];
};

function decode(buf: Buffer, file: string): any {
  return JSON.parse((file.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
}

export async function loadCatalog(): Promise<Catalog> {
  const local = process.env.CATALOG_FILE;
  if (local) {
    const d = decode(readFileSync(local), local);
    return { source: { repo: ENDPOINT_REPO, commit: null, file: local, generated_at: d.generated_at ?? null }, endpoints: d.endpoints };
  }
  const head = execFileSync("git", ["ls-remote", ENDPOINT_REPO, "refs/heads/main"], { encoding: "utf8" }).split(/\s/)[0];
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error(`could not resolve ${ENDPOINT_REPO} main: ${head}`);
  const file = "data/endpoints_full.json.gz";
  const r = await fetch(`${ENDPOINT_RAW}/${head}/${file}`, { headers: { "user-agent": USER_AGENT } });
  if (!r.ok) throw new Error(`catalog fetch ${r.status}`);
  const d = decode(Buffer.from(await r.arrayBuffer()), file);
  if (!Array.isArray(d.endpoints)) throw new Error("catalog has no endpoints array");
  return { source: { repo: ENDPOINT_REPO, commit: head, file, generated_at: d.generated_at ?? null }, endpoints: d.endpoints };
}

/** Hostname key used everywhere (lowercase, no port, no leading www.). */
export function hostKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** x402, priced in USDC, offered on Solana or Base, and a concrete URL (no `{param}` templates). */
export function isCandidate(e: CatalogEndpoint): boolean {
  return (
    (e.protocols ?? []).includes("x402") &&
    e.price?.currency === "USDC" &&
    Number.isFinite(e.price.amount) &&
    e.price.amount > 0 &&
    (e.networks ?? []).some((n) => n === "Solana" || n === "Base") &&
    !/%7B|%7D|[{}]/i.test(e.url) &&
    hostKey(e.url) !== null
  );
}

/** One representative per host: the cheapest endpoint (ties → shorter URL, then lexicographic). */
export function representatives(endpoints: CatalogEndpoint[]): Target[] {
  const best = new Map<string, CatalogEndpoint>();
  for (const e of endpoints) {
    if (!isCandidate(e)) continue;
    const h = hostKey(e.url)!;
    const cur = best.get(h);
    if (
      !cur ||
      e.price!.amount < cur.price!.amount ||
      (e.price!.amount === cur.price!.amount && (e.url.length < cur.url.length || (e.url.length === cur.url.length && e.url < cur.url)))
    )
      best.set(h, e);
  }
  return [...best.entries()]
    .map(([host, e]) => ({ host, url: e.url, endpoint_id: e.id, price_usd: e.price!.amount, networks: e.networks.filter((n) => n === "Solana" || n === "Base") }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

export const paidEligible = (t: Target) => t.price_usd <= LIMITS.catalogMaxPriceUsd;
