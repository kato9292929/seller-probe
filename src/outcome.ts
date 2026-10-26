// What a paid measurement amounts to. Works on old and new log rows alike, so rows
// written before this classification existed (2026-10-19) are read the same way
// without rewriting the append-only log.
//
//   delivered         transfer landed, then 200 with a non-empty body
//   not_delivered     transfer landed, then anything else (RFQ reason code 5)
//   request_rejected  no transfer, and the seller answered 4xx (incl. 402): the purchase
//                     never happened, so it is not a failure of the seller's delivery
//   failed            no transfer and something else (5xx, timeout, 200 without a payment)
export type PaidOutcome = "delivered" | "not_delivered" | "request_rejected" | "failed";

export function classifyPaid(r: Record<string, unknown>): PaidOutcome | null {
  if (r.kind !== "paid" || r.skipped || r.dry_run) return null;
  const transferred = typeof r.tx === "string" && r.tx.length > 0;
  const status = typeof r.http_status === "number" ? r.http_status : null;
  if (transferred) return status === 200 && Number(r.response_bytes ?? 0) > 0 ? "delivered" : "not_delivered";
  if (status !== null && status >= 400 && status < 500) return "request_rejected";
  return "failed";
}

/** The seller's stated reason for a rejected purchase, best available field first. */
export function rejectionText(r: Record<string, unknown>): string | null {
  for (const k of ["x402_error", "error_body"]) if (typeof r[k] === "string" && r[k]) return String(r[k]);
  return null;
}

/** The payer-side key a paid row was signed with (Solana signature or EIP-3009 nonce). */
export function payerKeyOf(r: Record<string, unknown>): string | null {
  const k = r.payer_key as Record<string, string> | null | undefined;
  return k?.payer_signature ?? k?.authorization_nonce ?? null;
}

/**
 * Append-only corrections: a `paid_reconciled` row (written by `npm run reconcile`) records
 * the payment tx later found on chain for a paid row that had none. Readers lay it over the
 * original row (matched by the payer's own signature/nonce) instead of rewriting the log.
 */
export function applyReconciliations<T extends Record<string, unknown>>(records: T[]): T[] {
  const fix = new Map<string, Record<string, unknown>>();
  for (const r of records) if (r.kind === "paid_reconciled" && typeof r.payer_key_value === "string") fix.set(r.payer_key_value, r);
  if (!fix.size) return records;
  return records.map((r) => {
    if (r.kind !== "paid" || r.tx) return r;
    const key = payerKeyOf(r);
    const f = key ? fix.get(key) : undefined;
    if (!f) return r;
    const merged: Record<string, unknown> = {
      ...r, tx: f.tx, tx_source: "onchain_search", onchain_ok: f.onchain_ok, onchain_detail: f.onchain_detail,
      settled_by: f.settled_by ?? r.settled_by ?? null, reconciled_at: f.ts,
    };
    merged.not_delivered = merged.onchain_ok === true && merged.http_status !== 200;
    merged.outcome = classifyPaid(merged);
    return merged as T;
  });
}
