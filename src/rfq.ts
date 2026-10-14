// RFQ market seller track record (indexer GET /sellers), shown next to the score as
// a reference only. It is never an input to the score.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, USER_AGENT } from "./config.js";

export type RfqSeller = {
  seller: string;
  quotes: number;
  awarded: number;
  fulfilled: number;
  rejected: number;
  rejected_by_reason: Record<string, number>;
  endpoint_hosts?: string[];
  [k: string]: unknown;
};
export type RfqSnapshot = { fetched_at: string | null; indexer: string | null; status: "ok" | "unavailable" | "not_configured"; note?: string; sellers: RfqSeller[] };

const FILE = () => resolve(ROOT, "data/rfq-sellers.json");

export function readRfqSnapshot(): RfqSnapshot {
  return existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : { fetched_at: null, indexer: null, status: "not_configured", sellers: [] };
}

/** Refresh from the indexer; on failure keep the previous snapshot and say so. */
export async function refreshRfqSnapshot(indexer = process.env.RFQ_INDEXER_URL): Promise<RfqSnapshot> {
  const prev = readRfqSnapshot();
  if (!indexer) return prev;
  try {
    const r = await fetch(`${indexer.replace(/\/$/, "")}/sellers`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const sellers = (await r.json()) as RfqSeller[];
    const snap: RfqSnapshot = { fetched_at: new Date().toISOString(), indexer, status: "ok", sellers };
    writeFileSync(FILE(), JSON.stringify(snap, null, 1) + "\n");
    return snap;
  } catch (e: any) {
    return { ...prev, status: "unavailable", note: `refresh failed: ${e?.message ?? e}; showing ${prev.fetched_at ?? "nothing"}` };
  }
}

/** RFQ sellers whose quoted endpoints are on `host`, summed. */
export function rfqForHost(snap: RfqSnapshot, host: string) {
  const rows = snap.sellers.filter((s) => (s.endpoint_hosts ?? []).includes(host));
  if (!rows.length) return null;
  const sum = (k: "quotes" | "awarded" | "fulfilled" | "rejected") => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const not_delivered = rows.reduce((n, r) => n + (r.rejected_by_reason?.not_delivered ?? 0), 0);
  return {
    sellers: rows.map((r) => r.seller),
    quotes: sum("quotes"), awarded: sum("awarded"), fulfilled: sum("fulfilled"), rejected: sum("rejected"), not_delivered,
    fetched_at: snap.fetched_at,
  };
}
