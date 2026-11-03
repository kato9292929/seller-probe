// One purchase of a seller whose 402 says x402 v2 but that refused a v2 payment, paid instead in
// the x402 v1 form (X-PAYMENT header, network "base", maxAmountRequired), to tell whether the
// seller only reads v1. Same caps and records as the paid probe: attempt before sending, result
// after, our nonce searched on chain when there is no settlement header.
//   npx tsx src/cli/retry-v1.ts <url>
import "dotenv/config";
import { createHash } from "node:crypto";
import { assertWithinBudget, spentLast7Days } from "../budget.js";
import { checkBaseTransfer, evmAuthorization, findBasePayment } from "../chains/base.js";
import { hostKey } from "../catalog.js";
import { bodySnippet, timedGet } from "../http.js";
import { LOG_DIR, append } from "../log.js";
import { classifyPaid } from "../outcome.js";
import { BASE_USDC_EIP712, makePayer, refuseReason, settleFrom } from "../pay.js";
import { parse402, primaryAccept } from "../x402.js";
import { loadLocalKeys } from "../wallet-env.js";

const url = process.argv[2];
if (!url) throw new Error("usage: retry-v1.ts <url>");
loadLocalKeys();
const payer = await makePayer();
const first = await timedGet(url);
if (first.res.status !== 402) throw new Error(`expected 402, got ${first.res.status}`);
const parsed = parse402((n) => first.res.headers.get(n), first.body.toString("utf8"));
const a = primaryAccept(parsed);
const refuse = refuseReason(a, payer.address);
if (refuse || !a || a.chain !== "base") throw new Error(`not payable here: ${refuse ?? a?.chain}`);
const amount = BigInt(a.amount!);
assertWithinBudget(amount, spentLast7Days());

const extra = { ...((a.raw as any)?.extra ?? {}) };
const filled = !(extra.name && extra.version);
if (filled) Object.assign(extra, BASE_USDC_EIP712);
const v1 = {
  scheme: "exact", network: "base", maxAmountRequired: a.amount, resource: url, description: "", mimeType: "application/json",
  payTo: a.payTo, maxTimeoutSeconds: (a.raw as any)?.maxTimeoutSeconds ?? 300, asset: a.asset, extra,
};
const payload: any = await payer.http.createPaymentPayload({ x402Version: 1, accepts: [v1] } as any);
const headers = payer.http.encodePaymentSignatureHeader(payload);
const auth = evmAuthorization(payload);
const payer_key = { authorization_nonce: auth.nonce, authorization_signature_sha256: createHash("sha256").update(auth.signature).digest("hex") };
const host = hostKey(url)!;
append(LOG_DIR(), {
  kind: "paid_attempt", host, url, network: a.network, chain: "base", amount: a.amount, pay_to: a.payTo, payer: payer.address.base,
  ...payer_key, ...(filled ? { eip712_filled: true } : {}), payment_form: "x402v1", header_names: Object.keys(headers),
});
const r = await timedGet(url, headers, 60_000);
const settle = settleFrom(payer, (n) => r.res.headers.get(n));
let tx = settle?.transaction ?? null;
let tx_source: string | null = tx ? "settle_header" : null;
let onchain_ok: boolean | null = null;
let onchain_detail: string | null = null;
const want = { payer: payer.address.base!, payTo: a.payTo!, amount };
if (!tx) {
  const f = await findBasePayment(want.payer, auth.nonce, 60_000);
  if (f) {
    tx = f.hash;
    tx_source = "onchain_search";
    const c = checkBaseTransfer(f.receipt, want);
    onchain_ok = c.ok;
    onchain_detail = c.reason;
  } else {
    onchain_ok = false;
    onchain_detail = "no landed payment found";
  }
}
const row: Record<string, unknown> = {
  kind: "paid", host, url, skipped: null, network: a.network, chain: "base", amount: a.amount, pay_to: a.payTo, payer: payer.address.base,
  payer_key, http_status: r.res.status, settle_ok: settle ? settle.success : false, settle_error: settle?.error ?? null, tx, tx_source,
  onchain_ok, onchain_detail, delivered: r.res.status === 200 && r.body.length > 0, not_delivered: onchain_ok === true && r.res.status !== 200,
  latency_paid_ms: r.total_ms, response_bytes: r.body.length, response_sha256: r.body.length ? createHash("sha256").update(r.body).digest("hex") : null,
  error_body: r.res.status !== 200 ? bodySnippet(r.body) : null, x402_error: r.res.status === 402 ? ((parse402((n) => r.res.headers.get(n), r.body.toString("utf8")).raw as any)?.error ?? null) : null,
  ...(filled ? { eip712_filled: true } : {}), payment_form: "x402v1", pick: "manual_v1_retry",
};
row.outcome = classifyPaid(row);
append(LOG_DIR(), row as any);
console.log(JSON.stringify({ host, http_status: r.res.status, outcome: row.outcome, settle_ok: row.settle_ok, tx, tx_source, onchain_ok, response_bytes: r.body.length, error: row.error_body ?? row.x402_error }));
