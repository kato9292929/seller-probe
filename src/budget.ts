// Payment limits, enforced before a payment is signed. Spend is counted from the
// append-only logs: every `*_attempt` record (written before the paid request is
// sent) counts as spent, whether or not the seller settled — the conservative side.
import { LIMITS } from "./config.js";
import { LOG_DIR, type LogRecord, SELF_CHECK_DIR, readRecords } from "./log.js";

export class BudgetError extends Error {}

const WINDOW_DAYS = 7;

export function spentFrom(records: LogRecord[], now = new Date()): bigint {
  const cutoff = now.getTime() - WINDOW_DAYS * 86_400_000;
  let sum = 0n;
  for (const r of records) {
    if (r.kind !== "paid_attempt" && r.kind !== "self_check_attempt") continue;
    if (r.dry_run) continue; // nothing was sent
    if (Date.parse(r.ts) < cutoff) continue;
    sum += BigInt(String(r.amount ?? "0"));
  }
  return sum;
}

export function spentLast7Days(now = new Date()): bigint {
  return spentFrom([...readRecords(LOG_DIR(), WINDOW_DAYS + 1, now), ...readRecords(SELF_CHECK_DIR(), WINDOW_DAYS + 1, now)], now);
}

/** Throws unless `amount` fits both the per-call and the rolling 7-day cap. */
export function assertWithinBudget(amount: bigint, spent: bigint): void {
  if (amount <= 0n) throw new BudgetError(`refusing non-positive amount ${amount}`);
  if (amount > LIMITS.perCall) throw new BudgetError(`amount ${amount} > per-call cap ${LIMITS.perCall} ($0.01)`);
  if (spent + amount > LIMITS.perWeek)
    throw new BudgetError(`weekly cap: spent ${spent} + ${amount} > ${LIMITS.perWeek} ($25 per 7 days)`);
}

/**
 * Spend for one run, for purchases made concurrently: starts from the logs (spentLast7Days)
 * and adds each attempt as it is written. `exclusive` runs the cap check, signing and the
 * attempt record one purchase at a time, so parallel purchases can never pass the cap together.
 */
export class SpendTracker {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(public spent: bigint) {}
  exclusive<T>(f: () => Promise<T>): Promise<T> {
    const run = this.tail.then(f, f);
    this.tail = run.catch(() => undefined);
    return run;
  }
}
