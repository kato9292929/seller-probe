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
    throw new BudgetError(`weekly cap: spent ${spent} + ${amount} > ${LIMITS.perWeek} ($5 per 7 days)`);
}
