// Delivery Receipt (kato9292929/delivery-receipt), measured from outside:
//   receipt_advertised (free probe): the seller publishes /.well-known/x402-receipt.json with ≥ 1 key;
//   receipt_ok (paid probe): the X-Delivery-Receipt on the paid 200 verifies (signature, body hash,
//   payment_id). A seller without receipts gets null — receipts are optional and never cost score.
import { USER_AGENT } from "./config.js";
import { errMsg } from "./http.js";
import { RECEIPT_HEADER, WELL_KNOWN_PATH, type WellKnown, parseWellKnown, verifyReceipt } from "./receipt/verify.js";

export { RECEIPT_HEADER };

export type WellKnownCheck = { advertised: boolean | null; wellKnown: WellKnown | null; error: string | null };

/** advertised: true = valid document with a key; false = none / invalid; null = the host could not be asked. */
export async function wellKnownOf(url: string, timeoutMs = 5000, redirect: RequestRedirect = "follow"): Promise<WellKnownCheck> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { advertised: null, wellKnown: null, error: "bad url" };
  }
  let res: Response;
  try {
    res = await fetch(origin + WELL_KNOWN_PATH, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), redirect });
  } catch (e) {
    return { advertised: null, wellKnown: null, error: errMsg(e) };
  }
  if (!res.ok) return { advertised: false, wellKnown: null, error: `HTTP ${res.status}` };
  try {
    const wk = parseWellKnown(await res.json());
    return { advertised: wk.keys.length > 0, wellKnown: wk, error: null };
  } catch (e) {
    return { advertised: false, wellKnown: null, error: `invalid ${WELL_KNOWN_PATH}: ${errMsg(e)}` };
  }
}

/** Verify a paid response's receipt. No receipt header → nulls (not counted). */
export async function receiptCheck(header: string | null, body: Uint8Array, url: string, paymentId: string | null,
  wellKnown?: WellKnown | null): Promise<{ receipt_ok: boolean | null; receipt_reason: string | null }> {
  if (!header) return { receipt_ok: null, receipt_reason: null };
  const wk = wellKnown ?? (await wellKnownOf(url)).wellKnown;
  if (!wk) return { receipt_ok: false, receipt_reason: `receipt_key_unknown (no usable ${WELL_KNOWN_PATH})` };
  const v = verifyReceipt({ header, body, wellKnown: wk, expect: paymentId ? { payment_id: paymentId } : undefined });
  return v.ok ? { receipt_ok: true, receipt_reason: null } : { receipt_ok: false, receipt_reason: v.detail ? `${v.reason}: ${v.detail}` : v.reason };
}
