// §4 Score per host from the last `window_days` of measurements. Pure.
import type { LogRecord } from "./log.js";
import { type PaidOutcome, applyReconciliations, outcomeOf, rejectionText } from "./outcome.js";

export type Weights = {
  version: number;
  effective_from: string;
  window_days: number;
  latency_ms: { full_marks_at_or_below: number; zero_at_or_above: number };
  free: Record<FreeItem, number>;
  paid: Record<PaidItem, number>;
  history: { version: number; date: string; change: string }[];
};

export const FREE_ITEMS = ["reachable", "status_402", "fields_valid", "asset_known", "payto_stable", "latency_402"] as const;
export const PAID_ITEMS = ["settle_ok", "onchain_ok", "delivered", "not_delivered", "latency_paid", "cache_header"] as const;
export type FreeItem = (typeof FREE_ITEMS)[number];
export type PaidItem = (typeof PAID_ITEMS)[number];

export type ItemStat = { value: number | null; n: number; weight: number };

export type HostScore = {
  host: string;
  score: number | null;
  coverage: "full" | "free_only";
  n_free: number;
  /** Paid measurements that count: the purchase happened (or failed in a way that is the seller's). */
  n_paid: number;
  /** Purchases that never happened: no transfer and a 4xx/402 answer. Not counted in the score. */
  n_rejected: number;
  /** 200 with a body but no settlement and nothing on chain: given away unpaid. Not a failure, not scored. */
  n_unsettled: number;
  paid_outcomes: Record<PaidOutcome, number>;
  last_rejection: { ts: string; http_status: number | null; error: string | null } | null;
  items: Record<string, ItemStat>;
  last_free_at: string | null;
  last_paid_at: string | null;
  latest: {
    url: string | null;
    spec_version: string | null;
    network: string | null;
    pay_to: string | null;
    amount: string | null;
    facilitator: string | null;
  };
};

export function latencyScore(ms: number, w: Weights): number {
  const { full_marks_at_or_below: good, zero_at_or_above: bad } = w.latency_ms;
  if (ms <= good) return 1;
  if (ms >= bad) return 0;
  return (bad - ms) / (bad - good);
}

/** Per measurement, each item is 1, 0, a latency fraction, or null (not observed → not counted). */
export function freeValues(r: LogRecord, w: Weights): Record<FreeItem, number | null> {
  const b = (v: unknown) => (v === true ? 1 : v === false ? 0 : null);
  return {
    reachable: b(r.reachable),
    // A failure upstream fails the steps after it (unreachable → no 402 → fields/asset not valid).
    status_402: b(r.status_402),
    fields_valid: b(r.fields_valid),
    asset_known: b(r.asset_known),
    payto_stable: b(r.payto_stable),
    latency_402: typeof r.latency_402_ms === "number" ? latencyScore(r.latency_402_ms, w) : null,
  };
}

export function paidValues(r: LogRecord, w: Weights): Record<PaidItem, number | null> {
  const b = (v: unknown) => (v === true ? 1 : v === false ? 0 : null);
  return {
    settle_ok: b(r.settle_ok),
    onchain_ok: b(r.onchain_ok),
    delivered: b(r.delivered),
    // Bad outcome → scored as 1 - rate.
    not_delivered: r.not_delivered === true ? 0 : r.not_delivered === false ? 1 : null,
    latency_paid: r.delivered === true && typeof r.latency_paid_ms === "number" ? latencyScore(r.latency_paid_ms, w) : null,
    cache_header: b(r.cache_header),
  };
}

export function scoreHosts(records: LogRecord[], w: Weights, now = new Date()): HostScore[] {
  const cutoff = now.getTime() - w.window_days * 86_400_000;
  const by = new Map<string, { free: LogRecord[]; paid: LogRecord[]; rejected: LogRecord[]; unsettled: LogRecord[] }>();
  for (const r of applyReconciliations(records)) {
    if (Date.parse(r.ts) < cutoff) continue;
    const isFree = r.kind === "free";
    // Dry-run rows never paid anything: they are not measurements.
    if (r.dry_run) continue;
    const isPaid = r.kind === "paid" && !r.skipped;
    if (!isFree && !isPaid) continue;
    const g = by.get(r.host) ?? { free: [], paid: [], rejected: [], unsettled: [] };
    // request_rejected (no transfer, 4xx/402) is read the same way for rows written before the
    // `outcome` field existed: it stays out of every paid item, numerator and denominator.
    if (isFree) g.free.push(r);
    else {
      const o = outcomeOf(r);
      (o === "request_rejected" ? g.rejected : o === "delivered_unsettled" ? g.unsettled : g.paid).push(r);
    }
    by.set(r.host, g);
  }
  const out: HostScore[] = [];
  for (const [host, g] of by) {
    g.free.sort((a, b) => a.ts.localeCompare(b.ts));
    g.paid.sort((a, b) => a.ts.localeCompare(b.ts));
    g.rejected.sort((a, b) => a.ts.localeCompare(b.ts));
    const outcomes: Record<PaidOutcome, number> = {
      delivered: 0, not_delivered: 0, request_rejected: g.rejected.length, delivered_unsettled: g.unsettled.length, failed: 0,
    };
    for (const r of g.paid) {
      const o = outcomeOf(r);
      if (o) outcomes[o]++;
    }
    const lastRej = g.rejected.at(-1);
    const items: Record<string, ItemStat> = {};
    const add = (name: string, weight: number, vals: (number | null)[]) => {
      const seen = vals.filter((v): v is number => v !== null);
      items[name] = { value: seen.length ? seen.reduce((s, v) => s + v, 0) / seen.length : null, n: seen.length, weight };
    };
    for (const k of FREE_ITEMS) add(k, w.free[k], g.free.map((r) => freeValues(r, w)[k]));
    if (g.paid.length) for (const k of PAID_ITEMS) add(k, w.paid[k], g.paid.map((r) => paidValues(r, w)[k]));
    let num = 0;
    let den = 0;
    for (const s of Object.values(items)) {
      if (s.value === null || s.weight <= 0) continue;
      num += s.weight * s.value;
      den += s.weight;
    }
    const lastFree = g.free.at(-1);
    const lastPaid = g.paid.at(-1);
    out.push({
      host,
      score: den ? Math.round((1000 * num) / den) / 10 : null,
      coverage: g.paid.length ? "full" : "free_only",
      n_free: g.free.length,
      n_paid: g.paid.length,
      n_rejected: g.rejected.length,
      n_unsettled: g.unsettled.length,
      paid_outcomes: outcomes,
      last_rejection: lastRej
        ? { ts: lastRej.ts, http_status: (lastRej.http_status as number | null) ?? null, error: rejectionText(lastRej) }
        : null,
      items,
      last_free_at: lastFree?.ts ?? null,
      last_paid_at: lastPaid?.ts ?? null,
      latest: {
        url: (lastFree?.url ?? lastPaid?.url ?? null) as string | null,
        spec_version: (lastFree?.spec_version ?? null) as string | null,
        network: (lastFree?.network ?? lastPaid?.network ?? null) as string | null,
        pay_to: (lastFree?.pay_to ?? lastPaid?.pay_to ?? null) as string | null,
        amount: (lastFree?.amount ?? lastPaid?.amount ?? null) as string | null,
        facilitator: (lastPaid?.facilitator ?? null) as string | null,
      },
    });
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.host.localeCompare(b.host));
}
