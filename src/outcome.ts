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
