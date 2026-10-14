// Call counts per host over the last 7 days: x402scan's origin ranking
// (public.sellers.bazaar.list, the procedure the endpoint repo's rank.json uses),
// asked for timeframe=7. If x402scan is unreachable, fall back to the endpoint
// repo's committed rank.json (1-day window) and say so in `metric`.
import { ENDPOINT_RAW, USER_AGENT } from "./config.js";

export type Popularity = {
  metric: string; // e.g. "x402scan:tx_count:7d"
  fetched_at: string;
  status: "ok" | "fallback" | "unavailable";
  note?: string;
  rows: { host: string; tx_count: number }[]; // descending
};

const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return origin;
  }
};

/** Pure: x402scan bazaar.list response → per-host rows (summed when several origins share a host). */
export function foldBazaar(body: any): { host: string; tx_count: number }[] {
  const data = body?.result?.data;
  const items = (data && typeof data === "object" && "json" in data ? data.json : data)?.items;
  if (!Array.isArray(items)) throw new Error("bazaar.list: no items array");
  const by = new Map<string, number>();
  for (const it of items) {
    const origin = it?.origins?.[0]?.origin;
    if (typeof origin !== "string") continue;
    const n = Number(it.tx_count);
    by.set(hostOf(origin), (by.get(hostOf(origin)) ?? 0) + (Number.isFinite(n) ? n : 0));
  }
  return [...by.entries()].map(([host, tx_count]) => ({ host, tx_count })).sort((a, b) => b.tx_count - a.tx_count);
}

export async function fetchPopularity(): Promise<Popularity> {
  const fetched_at = new Date().toISOString();
  const input = { json: { timeframe: 7, sorting: { id: "tx_count", desc: true }, pagination: { page: 0, page_size: 200 } } };
  const url = `https://x402scan.com/api/trpc/public.sellers.bazaar.list?${new URLSearchParams({ input: JSON.stringify(input) })}`;
  try {
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { metric: "x402scan:tx_count:7d", fetched_at, status: "ok", rows: foldBazaar(await r.json()) };
  } catch (e: any) {
    try {
      const r = await fetch(`${ENDPOINT_RAW}/main/data/rank.json`, { headers: { "user-agent": USER_AGENT } });
      const d: any = await r.json();
      if (d.status !== "ok") throw new Error(`rank.json status ${d.status}`);
      return {
        metric: d.metric, fetched_at, status: "fallback",
        note: `x402scan 7d unavailable (${e?.message ?? e}); using endpoint rank.json (${d.metric}, ${d.generated_at})`,
        rows: d.rows.map((x: any) => ({ host: hostOf(x.origin), tx_count: Number(x.tx_count) })),
      };
    } catch (e2: any) {
      return { metric: "none", fetched_at, status: "unavailable", note: `${e?.message ?? e}; ${e2?.message ?? e2}`, rows: [] };
    }
  }
}
