import "dotenv/config";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config.js";
import { LOG_DIR, readRecords } from "../log.js";
import { refreshRfqSnapshot, rfqForHost } from "../rfq.js";
import { type Weights, scoreHosts } from "../score.js";

const OUT = resolve(ROOT, process.env.PROBE_PUBLIC_DIR ?? "public/data");
const weights: Weights = JSON.parse(readFileSync(resolve(ROOT, "config/weights.json"), "utf8"));
const now = new Date();
const records = readRecords(LOG_DIR(), weights.window_days, now);
const scores = scoreHosts(records, weights, now);
const rfq = await refreshRfqSnapshot();

const HISTORY_KEYS = [
  "ts", "kind", "url", "reachable", "http_status", "status_402", "spec_version", "fields_valid", "field_problems", "asset_known", "network",
  "pay_to", "amount", "payto_stable", "latency_402_ms", "error", "skipped", "settle_ok", "tx", "tx_source", "onchain_ok", "onchain_detail",
  "delivered", "not_delivered", "latency_paid_ms", "cache_header", "facilitator",
];
const pick = (r: Record<string, unknown>) => Object.fromEntries(HISTORY_KEYS.filter((k) => k in r).map((k) => [k, r[k]]));

rmSync(resolve(OUT, "hosts"), { recursive: true, force: true });
mkdirSync(resolve(OUT, "hosts"), { recursive: true });
const generated_at = now.toISOString();
for (const s of scores) {
  const history = records
    .filter((r) => r.host === s.host && (r.kind === "free" || r.kind === "paid"))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 60)
    .map(pick);
  writeFileSync(resolve(OUT, "hosts", `${s.host}.json`), JSON.stringify({ generated_at, weights_version: weights.version, ...s, rfq: rfqForHost(rfq, s.host), history }) + "\n");
}
const list = scores.map(({ items, ...s }) => ({ ...s, rfq: rfqForHost(rfq, s.host) }));
writeFileSync(
  resolve(OUT, "scores.json"),
  JSON.stringify({
    generated_at, window_days: weights.window_days, weights_version: weights.version, hosts: list.length,
    rfq: { status: rfq.status, fetched_at: rfq.fetched_at, note: rfq.note ?? null, used_in_score: false },
    scores: list,
  }) + "\n",
);
writeFileSync(resolve(OUT, "weights.json"), JSON.stringify(weights, null, 1) + "\n");
console.log(`scored ${list.length} hosts (${list.filter((s) => s.coverage === "full").length} full, rest free_only) from ${records.length} records → ${OUT}`);
