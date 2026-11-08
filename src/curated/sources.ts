// Where the curated list comes from:
//  - x402 Endpoint (endpoint.x402jp.com): the "Most-called endpoints" table (x402scan's numbers:
//    tx count, USDC settled, buyers per service) and the two "own domain" provider tables;
//  - the CDP x402 Bazaar (facilitator discovery): per-endpoint input/output definitions and
//    30-day calls / unique payers;
//  - x402scan's seller list: payTo addresses (recipients) and unique buyers per service.
import { USDC, USER_AGENT } from "../config.js";

export const ENDPOINT_SITE = "https://endpoint.x402jp.com";
export const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

export const hostOf = (u: string): string | null => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

export type Operator = {
  host: string;
  name: string;
  source: "most_called" | "known_company" | "other_provider";
  rank: number;
  tx_count: number | null; // Most-called: x402scan calls over the table's window
  usdc_settled: number | null;
  buyers: number | null;
  category: string | null;
};

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'");
const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// The host cell can carry " · 0.02 USDC · Base" after the host.
const cleanHost = (s: string) => s.split("·")[0].trim().toLowerCase().replace(/^www\./, "");

function rowsOf(block: string): string[][] {
  const out: string[][] = [];
  const re = /<div class="grid grid-cols-\[2\.5rem_1fr_auto\][^"]*">([\s\S]*?)(?=<div class="grid grid-cols-\[2\.5rem_1fr_auto\]|<\/div><\/div><\/div>|<p[ >]|<h3|$)/g;
  for (const m of block.matchAll(re)) {
    const cells = decode(m[1].replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "\u0001")).split("\u0001").map((c) => c.trim()).filter(Boolean);
    out.push(cells);
  }
  return out;
}

/** Pure: the three tables out of the home page HTML. */
export function parseEndpointTables(html: string): Operator[] {
  const at = (id: string) => html.indexOf(`<section id="${id}"`);
  const next = (from: number) => {
    const i = html.indexOf("<section id=", from + 10);
    return i < 0 ? html.length : i;
  };
  const ops: Operator[] = [];
  const mc = at("most-called");
  if (mc >= 0)
    for (const c of rowsOf(html.slice(mc, next(mc)))) {
      // [rank, name, host, (· price)?, (· chain)?, tx, $usdc, buyers, category]
      const tail = c.slice(-4);
      ops.push({
        host: cleanHost(c[2]), name: c[1], source: "most_called", rank: Number(c[0]),
        tx_count: num(tail[0]), usdc_settled: num(tail[1]), buyers: num(tail[2]), category: tail[3] === "—" ? null : tail[3],
      });
    }
  const pv = at("providers");
  if (pv >= 0) {
    const sec = html.slice(pv, next(pv));
    const split = sec.indexOf("Other providers on their own domain");
    for (const [part, source] of [[sec.slice(0, split < 0 ? sec.length : split), "known_company"], [split < 0 ? "" : sec.slice(split), "other_provider"]] as const)
      for (const c of rowsOf(part))
        // [rank, name, host, endpoints, median price, category]
        ops.push({ host: cleanHost(c[2]), name: c[1], source, rank: Number(c[0]), tx_count: null, usdc_settled: null, buyers: null, category: c[5] ?? null });
  }
  return ops;
}

export async function fetchEndpointTables(): Promise<Operator[]> {
  const r = await fetch(`${ENDPOINT_SITE}/`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`endpoint.x402jp.com: HTTP ${r.status}`);
  const ops = parseEndpointTables(await r.text());
  if (!ops.some((o) => o.source === "most_called")) throw new Error("endpoint.x402jp.com: Most-called table not found");
  return ops;
}

/** One Bazaar resource, reduced to what the curation and the request builder use. */
export type BazaarItem = {
  resource: string;
  host: string;
  description: string | null;
  serviceName: string | null;
  accepts: { scheme: string; network: string; amount: string | null; asset: string | null; payTo: string | null; extra?: Record<string, unknown> }[];
  input: unknown; // extensions.bazaar.info.input
  inputSchema: unknown; // extensions.bazaar.schema.properties.input
  output: unknown; // extensions.bazaar.info.output (type, example)
  outputSchema: unknown; // extensions.bazaar.schema.properties.output
  calls30d: number | null;
  payers30d: number | null;
  lastCalledAt: string | null;
};

export function reduceBazaar(it: any): BazaarItem | null {
  const host = typeof it?.resource === "string" ? hostOf(it.resource) : null;
  if (!host) return null;
  const bz = it.extensions?.bazaar ?? {};
  return {
    resource: it.resource, host, description: it.description ?? null, serviceName: it.serviceName ?? null,
    accepts: (it.accepts ?? []).map((a: any) => ({
      scheme: a.scheme, network: a.network, amount: a.amount ?? a.maxAmountRequired ?? null, asset: a.asset ?? null, payTo: a.payTo ?? null,
      ...(a.extra ? { extra: a.extra } : {}),
    })),
    input: bz.info?.input ?? null, inputSchema: bz.schema?.properties?.input ?? null,
    output: bz.info?.output ?? null, outputSchema: bz.schema?.properties?.output ?? null,
    calls30d: typeof it.quality?.l30DaysTotalCalls === "number" ? it.quality.l30DaysTotalCalls : null,
    payers30d: typeof it.quality?.l30DaysUniquePayers === "number" ? it.quality.l30DaysUniquePayers : null,
    lastCalledAt: it.quality?.lastCalledAt ?? null,
  };
}

export async function fetchBazaar(): Promise<BazaarItem[]> {
  const out: BazaarItem[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${BAZAAR_URL}?type=http&limit=1000&offset=${offset}`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`bazaar: HTTP ${r.status}`);
    const j: any = await r.json();
    for (const it of j.items ?? []) {
      const b = reduceBazaar(it);
      if (b) out.push(b);
    }
    if (offset + 1000 >= Number(j.pagination?.total ?? 0) || !(j.items ?? []).length) break;
  }
  return out;
}

export type Seller = { hosts: string[]; titles: string[]; descriptions: string[]; tx_count: number; unique_buyers: number | null; recipients: string[] };

/** x402scan's seller list (7 days), as host → seller. A seller groups the origins sharing its payTo. */
export async function fetchSellers(pages = 3): Promise<Map<string, Seller>> {
  const by = new Map<string, Seller>();
  for (let page = 0; page < pages; page++) {
    const input = { json: { timeframe: 7, sorting: { id: "tx_count", desc: true }, pagination: { page, page_size: 200 } } };
    const r = await fetch(`https://x402scan.com/api/trpc/public.sellers.bazaar.list?${new URLSearchParams({ input: JSON.stringify(input) })}`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) break;
    const d: any = await r.json();
    const data = d?.result?.data?.json ?? d?.result?.data;
    for (const it of data?.items ?? []) {
      const origins = (it.origins ?? []) as { origin: string; title?: string; description?: string }[];
      const s: Seller = {
        hosts: [...new Set(origins.map((o) => hostOf(o.origin)).filter((h): h is string => !!h))],
        titles: origins.map((o) => o.title ?? "").filter(Boolean), descriptions: origins.map((o) => o.description ?? "").filter(Boolean),
        tx_count: Number(it.tx_count ?? 0), unique_buyers: typeof it.unique_buyers === "number" ? it.unique_buyers : null,
        recipients: (it.recipients ?? []).map((x: string) => x.toLowerCase()),
      };
      for (const h of s.hosts) if (!by.has(h)) by.set(h, s);
    }
    if (!data?.hasNextPage) break;
  }
  return by;
}

/** The x402 Endpoint catalog (/api/endpoints: its 20,000 browsable endpoints; no input definitions). */
export async function fetchCatalog(): Promise<import("./curate.js").CatalogEndpoint[]> {
  const r = await fetch(`${ENDPOINT_SITE}/api/endpoints`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`endpoint.x402jp.com/api/endpoints: HTTP ${r.status}`);
  const j: any = await r.json();
  return (j.endpoints ?? []).map((e: any) => ({
    id: e.id, url: e.url, name: e.name ?? null, description: e.description ?? null, category: e.category ?? null,
    networks: e.networks ?? [], source: e.source ?? [], source_url: e.source_url ?? null,
  }));
}

/** Logs over this many Base blocks per query (publicnode's limit); 7 days is ~302,400 blocks. */
const LOG_SPAN = 50_000;
export const BASE_LOGS_RPC = () => process.env.BASE_LOGS_RPC_URL || "https://base-rpc.publicnode.com";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/**
 * Self-trade on Base: a USDC Transfer from payTo to payTo (the buyer's address is the seller's own)
 * within the last `days`. Returns the first such tx, null when none, or throws when the logs
 * cannot be read (the caller records "not checked"). Solana is not checked.
 */
export async function baseSelfTrade(payTo: string, days = 7, url = BASE_LOGS_RPC()): Promise<string | null> {
  const { rpc } = await import("../chains/rpc.js");
  const head = parseInt(await rpc<string>(url, "eth_blockNumber", []), 16);
  const from = head - Math.ceil((days * 86_400) / 2);
  for (let hi = head; hi > from; hi -= LOG_SPAN) {
    const lo = Math.max(from, hi - LOG_SPAN + 1);
    const logs = await rpc<any[]>(url, "eth_getLogs", [{
      address: USDC.base, fromBlock: "0x" + lo.toString(16), toBlock: "0x" + hi.toString(16), topics: [TRANSFER, topic(payTo), topic(payTo)],
    }]);
    if (logs.length) return logs[0].transactionHash;
  }
  return null;
}
