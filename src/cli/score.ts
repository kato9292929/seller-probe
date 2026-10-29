import "dotenv/config";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config.js";
import { LOG_DIR, readRecords } from "../log.js";
import { refreshRfqSnapshot, rfqForHost } from "../rfq.js";
import { applyReconciliations, outcomeOf } from "../outcome.js";
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
  "delivered", "not_delivered", "latency_paid_ms", "cache_header", "facilitator", "outcome", "x402_error", "error_body", "dry_run", "receipt_advertised", "receipt_ok", "receipt_reason", "eip712_filled",
];
// `outcome` is read again for every paid row (rows written before a class existed, and rows a
// `paid_resolution` re-reads); read-time only, the log is not rewritten.
const pick = (r: Record<string, unknown>) => {
  const o = Object.fromEntries(HISTORY_KEYS.filter((k) => k in r).map((k) => [k, r[k]]));
  if (r.kind === "paid" && outcomeOf(r)) o.outcome = outcomeOf(r);
  return o;
};

// Which popular hosts the paid probe left out because a bare GET cannot buy them.
let paidTargets: Record<string, unknown> | null = null;
// Per host, what the latest selection judged: buyable with a bare GET (selected), or not and why.
const judged = new Map<string, { buyable: boolean; reason: string | null; evidence?: Record<string, unknown> }>();
try {
  const t = latestTargets();
  for (const x of [...t.paid.top, ...t.paid.random]) judged.set(x.host, { buyable: true, reason: null });
  for (const d of t.paid.screened?.dropped ?? [])
    if (/^(requires_input|requires_auth|no_402|not_payable)/.test(d.reason)) judged.set(d.host, { buyable: false, reason: d.reason, evidence: d.evidence });
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

/**
 * For buyers checking a seller before paying (RFQ, Autonomous Agent):
 *  - buyable_without_input: true = picked by the latest selection; false = screened out as not
 *    buyable with a bare GET (input or auth required, no 402, nothing payable); null = not judged
 *    (outside the ranking, over the price cap, or excluded);
 *  - requires_input_reason: when an input/auth requirement was the reason, its source (the 402's
 *    schema, or the seller's own error answer) and the evidence;
 *  - last_paid: the latest purchase that was sent.
 */
const lastPaidBy = new Map<string, (typeof records)[number]>();
for (const r of records) {
  if (r.kind !== "paid" || r.skipped || r.dry_run) continue;
  const cur = lastPaidBy.get(r.host);
  if (!cur || r.ts > cur.ts) lastPaidBy.set(r.host, r);
}
function buyerView(host: string) {
  const j = judged.get(host);
  const req = j?.reason && /^requires_(input|auth)/.test(j.reason) ? j.reason : null;
  const last = lastPaidBy.get(host);
  return {
    buyable_without_input: j ? j.buyable : null,
    requires_input_reason: req
      ? { source: req.includes("(observed)") ? "observed" : "schema", reason: req, evidence: j?.evidence ?? null }
      : null,
    last_paid: last
      ? {
          date: last.ts.slice(0, 10), ts: last.ts, outcome: outcomeOf(last),
          amount: (last.amount ?? null) as string | null, price_usd: last.amount ? Number(last.amount) / 1e6 : null,
          network: (last.network ?? null) as string | null, latency_ms: (last.latency_paid_ms ?? null) as number | null,
        }
      : null,
  };
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
  writeFileSync(resolve(OUT, "hosts", `${s.host}.json`), JSON.stringify({ generated_at, weights_version: weights.version, ...s, ...buyerView(s.host), rfq: rfqForHost(rfq, s.host), history }) + "\n");
}
const list = scores.map(({ items, ...s }) => {
  const v = buyerView(s.host);
  return { ...s, buyable_without_input: v.buyable_without_input, last_paid: v.last_paid ? { outcome: v.last_paid.outcome } : null, rfq: rfqForHost(rfq, s.host) };
});
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
