// §3.2 Paid probe: buy one call at the seller's price (≤ $0.01) and check settlement,
// the on-chain transfer and delivery. Also the building block for §3.3 self-checks.
import { BudgetError, assertWithinBudget, spentLast7Days } from "./budget.js";
import type { Target } from "./catalog.js";
import { checkBaseTransfer, findBasePayment, verifyBaseTransfer } from "./chains/base.js";
import { checkSolanaTransfer, findSolanaPayment, verifySolanaTransfer } from "./chains/solana.js";
import { facilitatorFromExtra, loadFeePayerMap } from "./facilitator.js";
import { bodySnippet, errMsg, timedGet } from "./http.js";
import { type Kind, append } from "./log.js";
import { type Payer, refuseReason, settleFrom, signFor } from "./pay.js";
import { type PaidOutcome, classifyPaid } from "./outcome.js";
import { type Accept, type Parsed402, inputRequirement, parse402, primaryAccept, x402Error } from "./x402.js";

export type PaidResult = {
  kind: "paid" | "self_check";
  host: string;
  url: string;
  /** Not paid: why (unreachable, not 402, refused accept, budget). The measurement is then not scored. */
  skipped: string | null;
  network: string | null;
  chain: string | null;
  amount: string | null;
  pay_to: string | null;
  payer: string | null;
  payer_key: Record<string, string> | null;
  /** --dry-run: 402, cap checks and signing only; nothing is sent. Ignored by score and budget. */
  dry_run?: true;
  /** Result of the per-call and 7-day caps (null when no payable 402 was offered). */
  cap_check?: { pass: boolean; reason: string | null } | null;
  http_status: number | null;
  settle_ok: boolean | null;
  settle_error: string | null;
  /** Payment tx: from the settle header, or found on chain by our own signature/nonce. */
  tx: string | null;
  tx_source: "settle_header" | "onchain_search" | null;
  onchain_ok: boolean | null;
  onchain_detail: string | null;
  settled_by: string | null;
  delivered: boolean | null;
  not_delivered: boolean | null;
  latency_paid_ms: number | null;
  response_bytes: number | null;
  cache_control: string | null;
  cache_header: boolean | null;
  facilitator: string | null;
  facilitator_by: string | null;
  fee_payer: string | null;
  error: string | null;
  /** delivered / not_delivered / request_rejected / failed (outcome.ts); null when nothing was bought. */
  outcome: PaidOutcome | null;
  /** On a non-200 paid response: the 402's `error` field, and the first 300 characters of the body. */
  x402_error: string | null;
  error_body: string | null;
};

export type PaidRun = PaidResult & { /** Kept for the self-check (replay of the same header). */ _payment_headers?: Record<string, string>; _body?: Buffer };

/** How long to look on chain for our own payment after a non-200 (tests set 0). */
const FIND_MS = () => Number(process.env.PROBE_FIND_TIMEOUT_MS ?? 90_000);

type Ctx = { payer: Payer; logDir: string; attemptKind: Kind; resultKind: "paid" | "self_check"; extra?: Record<string, unknown>; dryRun?: boolean };

function empty(kind: PaidResult["kind"], t: Target): PaidResult {
  return {
    kind, host: t.host, url: t.url, skipped: null, network: null, chain: null, amount: null, pay_to: null, payer: null, payer_key: null,
    http_status: null, settle_ok: null, settle_error: null, tx: null, tx_source: null, onchain_ok: null, onchain_detail: null, settled_by: null,
    delivered: null, not_delivered: null, latency_paid_ms: null, response_bytes: null, cache_control: null, cache_header: null,
    facilitator: null, facilitator_by: null, fee_payer: null, error: null, outcome: null, x402_error: null, error_body: null,
  };
}

export async function probePaid(t: Target, ctx: Ctx): Promise<PaidRun> {
  const out: PaidRun = { ...empty(ctx.resultKind, t), ...(ctx.dryRun ? { dry_run: true as const, cap_check: null } : {}) };
  // 1. unpaid GET → 402
  let parsed: Parsed402;
  let a: Accept | undefined;
  try {
    const r = await timedGet(t.url);
    // Only GET is bought: a POST-only endpoint needs an input we do not know, and a
    // 4xx after payment would be our fault, not the seller's.
    if (r.res.status !== 402) return { ...out, skipped: `HTTP ${r.res.status} on GET, not 402`, http_status: r.res.status };
    parsed = parse402((n) => r.res.headers.get(n), r.body.toString("utf8"));
    a = primaryAccept(parsed);
  } catch (e) {
    return { ...out, skipped: `unreachable: ${errMsg(e)}` };
  }
  if (a) Object.assign(out, { network: a.network ?? null, chain: a.chain, amount: a.amount ?? null, pay_to: a.payTo ?? null });
  // Only endpoints that can be bought with a bare GET: a required body/query/method would
  // make any failure ours. Judged from the 402's own schemas; no schema = no known input.
  const need = inputRequirement(parsed);
  if (need.requires) return { ...out, skipped: `requires_input: ${need.reason}` };
  const refuse = refuseReason(a, ctx.payer.address);
  if (refuse || !a) return { ...out, skipped: `not paid: ${refuse}`, ...(ctx.dryRun ? { cap_check: { pass: false, reason: refuse } } : {}) };
  const amount = BigInt(a.amount!);
  const fac = facilitatorFromExtra(a.extra, loadFeePayerMap());
  Object.assign(out, {
    network: a.network!, chain: a.chain!, amount: a.amount!, pay_to: a.payTo!, payer: ctx.payer.address[a.chain!],
    facilitator: fac.facilitator, facilitator_by: fac.by, fee_payer: fac.fee_payer,
  });

  // 2. hard caps, before anything is signed
  try {
    assertWithinBudget(amount, spentLast7Days());
  } catch (e) {
    if (e instanceof BudgetError) return { ...out, skipped: `budget: ${e.message}`, ...(ctx.dryRun ? { cap_check: { pass: false, reason: e.message } } : {}) };
    throw e;
  }
  if (ctx.dryRun) out.cap_check = { pass: true, reason: null };

  // 3. sign, and log our own signature/nonce BEFORE sending (counts against the budget from here on)
  let signed;
  try {
    signed = await signFor(ctx.payer, parsed, a);
  } catch (e) {
    return { ...out, skipped: `could not sign: ${errMsg(e)}` };
  }
  out.payer_key = signed.payer_key;
  // Dry run stops here: the signed header is never sent and never written anywhere
  // (a signed EIP-3009 authorization can be submitted by anyone, a signed Solana tx
  // while its blockhash is valid). Only the payer-side identifiers above are kept.
  if (ctx.dryRun) return { ...out, skipped: "dry_run: signed, not sent" };
  append(ctx.logDir, {
    kind: ctx.attemptKind, host: t.host, url: t.url, network: a.network, chain: a.chain, amount: a.amount, pay_to: a.payTo,
    payer: out.payer, ...signed.payer_key, ...(ctx.extra ?? {}),
  });

  // 4. paid request
  let status: number;
  let body: Buffer;
  let getHeader: (n: string) => string | null;
  try {
    const r = await timedGet(t.url, signed.headers, 60_000);
    status = r.res.status;
    body = r.body;
    getHeader = (n) => r.res.headers.get(n);
    out.latency_paid_ms = r.total_ms;
  } catch (e) {
    status = 0;
    body = Buffer.alloc(0);
    getHeader = () => null;
    out.error = `paid request: ${errMsg(e)}`;
  }
  out.http_status = status || null;
  out.response_bytes = body.length;
  if (status !== 200) {
    out.error_body = bodySnippet(body);
    if (status === 402) out.x402_error = x402Error(parse402(getHeader, body.toString("utf8")));
  }
  const settle = settleFrom(ctx.payer, getHeader);
  out.settle_ok = settle ? settle.success : false;
  out.settle_error = settle ? settle.error : "no PAYMENT-RESPONSE / X-PAYMENT-RESPONSE header";
  out.cache_control = getHeader("cache-control");
  out.cache_header = status === 200 ? /(^|,)\s*no-store\s*(,|$)/i.test(out.cache_control ?? "") : null;
  out.delivered = status === 200 && body.length > 0;
  out._payment_headers = signed.headers;
  out._body = body;
  const want = { payer: out.payer!, payTo: a.payTo!, amount };

  // 5. find and check the transfer
  if (settle?.transaction) {
    out.tx = settle.transaction;
    out.tx_source = "settle_header";
  } else if (status !== 200) {
    // Same rule as the RFQ buyer: no 200 → search the chain for the tx carrying our own signature.
    const found =
      a.chain === "solana"
        ? await findSolanaPayment(out.payer!, signed.payer_key.payer_signature, FIND_MS()).then((f) => f && { tx: f.signature, check: checkSolanaTransfer(f.tx, want) })
        : await findBasePayment(out.payer!, signed.payer_key.authorization_nonce, FIND_MS()).then((f) => f && { tx: f.hash, check: checkBaseTransfer(f.receipt, want) });
    if (found) {
      out.tx = found.tx;
      out.tx_source = "onchain_search";
      out.onchain_ok = found.check.ok;
      out.onchain_detail = found.check.reason;
      out.settled_by = found.check.fee_payer ?? null;
    }
  }
  if (out.tx && out.onchain_ok === null) {
    const check = a.chain === "solana" ? await verifySolanaTransfer(out.tx, want) : await verifyBaseTransfer(out.tx, want);
    out.onchain_ok = check.ok;
    out.onchain_detail = check.reason;
    out.settled_by = check.fee_payer ?? null;
  }
  if (!out.tx) {
    out.onchain_ok = false;
    out.onchain_detail = status === 200 ? "200 without a settlement tx" : "no landed payment found";
  }
  // RFQ reason code 5: the transfer landed, the data did not come back.
  out.not_delivered = out.onchain_ok === true && status !== 200;
  out.outcome = classifyPaid(out as unknown as Record<string, unknown>);
  return out;
}

/** The record written to the log (drops in-memory fields). */
export function toRecord(r: PaidRun): Omit<PaidResult, never> {
  const { _payment_headers, _body, ...rec } = r;
  return rec;
}
