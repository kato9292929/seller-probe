// Re-curate the endpoints the weekly purchase buys (targets/curated.json), from the latest
// x402 Endpoint tables, the CDP Bazaar and x402scan. Run monthly (curate-monthly workflow).
//   npm run curate            write targets/curated.json
//   CURATE_CACHE=dir npm run curate   reuse/save the raw downloads in dir (local runs)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config.js";
import { curate } from "../curated/curate.js";
import { BAZAAR_URL, ENDPOINT_SITE, baseSelfTrade, fetchBazaar, fetchCatalog, fetchEndpointTables, fetchSellers } from "../curated/sources.js";

const cache = process.env.CURATE_CACHE;
async function cached<T>(name: string, f: () => Promise<T>): Promise<T> {
  if (!cache) return f();
  const p = resolve(cache, `${name}.json`);
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"), (k, v) => (k === "__map" ? new Map(v) : v)) as T;
  const v = await f();
  mkdirSync(cache, { recursive: true });
  writeFileSync(p, JSON.stringify(v instanceof Map ? { __map: [...v] } : v));
  return v;
}
const unmap = <T>(v: any): T => (v && v.__map instanceof Map ? v.__map : v);

const operators = await cached("tables", fetchEndpointTables);
console.log(`x402 Endpoint tables: ${operators.length} rows`);
const sellers = unmap<Map<string, any>>(await cached("sellers", fetchSellers));
console.log(`x402scan sellers: ${sellers.size} hosts`);
const bazaar = await cached("bazaar", fetchBazaar);
console.log(`Bazaar: ${bazaar.length} resources`);
const catalog = await cached("catalog", fetchCatalog);
console.log(`x402 Endpoint catalog: ${catalog.length} endpoints`);

// Self-trade (buyer = payTo) on Base for every candidate operator's EVM payTo addresses.
const hosts = [...new Set(operators.map((o) => o.host))];
const selfTrade = new Map<string, { address: string; tx: string }>();
const checked: Record<string, string> = {};
for (const h of hosts) {
  const payTos = new Set<string>([
    ...((sellers.get(h)?.recipients ?? []) as string[]),
    ...bazaar.filter((b) => b.host === h).flatMap((b) => b.accepts.map((a) => a.payTo ?? "")),
  ].map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)));
  if (!payTos.size) {
    checked[h] = "not checked: no Base payTo known";
    continue;
  }
  const notes: string[] = [];
  for (const p of [...payTos].slice(0, 5)) {
    try {
      const tx = await baseSelfTrade(p);
      if (tx) {
        selfTrade.set(h, { address: p, tx });
        notes.push(`${p}: self-transfer ${tx}`);
        break;
      }
      notes.push(`${p}: none in 7 days`);
    } catch (e) {
      notes.push(`${p}: logs unreadable (${(e as Error).message.slice(0, 80)})`);
    }
  }
  checked[h] = notes.join("; ");
}

const out = curate({
  operators, bazaar, sellers, catalog, selfTrade,
  sources: {
    tables: `${ENDPOINT_SITE}/ (Most-called endpoints, Companies you already know, Other providers on their own domain)`,
    catalog: `${ENDPOINT_SITE}/api/endpoints`,
    bazaar: `${BAZAAR_URL}?type=http`,
    sellers: "https://x402scan.com/api/trpc/public.sellers.bazaar.list (7 days)",
    self_trade: "Base USDC Transfer logs from payTo to payTo, last 7 days (Solana not checked)",
  },
});
const file = resolve(ROOT, "targets/curated.json");
writeFileSync(file, JSON.stringify({ ...out, self_trade_checks: checked }, null, 1) + "\n");
console.log(`curated: ${out.items.length} endpoints from ${new Set(out.items.map((i) => i.operator)).size} operators; excluded ${JSON.stringify(out.excluded_counts)} → ${file}`);
