import "dotenv/config";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config.js";
import { LOG_DIR, readRecords } from "../log.js";
import { refreshRfqSnapshot, rfqForHost } from "../rfq.js";
import { applyReconciliations, classifyPaid } from "../outcome.js";
import { type Weights, scoreHosts } from "../score.js";
import { latestTargets } from "../targets.js";

const OUT = resolve(ROOT, process.env.PROBE_PUBLIC_DIR ?? "dist/data");
const weights: Weights = JSON.parse(readFileSync(resolve(ROOT, "config/weights.json"), "utf8"));
const now = new Date();
const records = applyReconciliations(readRecords(LOG_DIR(), weights.window_days, now));
const scores = scoreHosts(records, weights, now);
const rfq = await refreshRfqSnapshot();

const HISTORY_KEYS = [
  "ts", "kind", "url", "reachable", "http_status", "status_402", "spec_version", "fields_valid", "field_problems", "asset_known", "network",
  "pay_to", "amount", "payto_stable", "latency_402_ms", "error", "skipped", "settle_ok", "tx", "tx_source", "onchain_ok", "onchain_detail",
  "delivered", "not_delivered", "latency_paid_ms", "cache_header", "facilitator", "outcome", "x402_error", "error_body", "dry_run",
];
// `outcome` is filled in for paid rows written before the field existed (read-time only; the log is not rewritten).
const pick = (r: Record<string, unknown>) => {
  const o = Object.fromEntries(HISTORY_KEYS.filter((k) => k in r).map((k) => [k, r[k]]));
  if (r.kind === "paid" && !("outcome" in r)) o.outcome = classifyPaid(r);
  return o;
};

// Which popular hosts the paid probe left out because a bare GET cannot buy them.
let paidTargets: Record<string, unknown> | null = null;
try {
  const t = latestTargets();
  paidTargets = {
    date: t.date,
    phase: t.paid.phase,
    top: t.paid.top.map((x) => x.host),
    random: t.paid.random.map((x) => x.host),
    requires_input: t.paid.screened?.requires_input ?? null,
    dropped: t.paid.screened?.dropped ?? null,
  };
} catch {
  paidTargets = null;
}

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
    paid_targets: paidTargets,
    scores: list,
  }) + "\n",
);
writeFileSync(resolve(OUT, "weights.json"), JSON.stringify(weights, null, 1) + "\n");
console.log(`scored ${list.length} hosts (${list.filter((s) => s.coverage === "full").length} full, rest free_only) from ${records.length} records → ${OUT}`);
