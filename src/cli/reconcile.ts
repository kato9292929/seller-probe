// Look on chain for the payment of paid rows that recorded no tx (e.g. a 200 without a
// settlement header) and append what was found as `paid_reconciled` rows. The original
// rows are never rewritten; readers lay the correction over them (outcome.ts).
import "dotenv/config";
import { checkBaseTransfer, findBasePayment } from "../chains/base.js";
import { checkSolanaTransfer, findSolanaPayment } from "../chains/solana.js";
import { LOG_DIR, append, readRecords } from "../log.js";
import { payerKeyOf } from "../outcome.js";

const days = Number(process.env.RECONCILE_DAYS ?? 14);
const recs = readRecords(LOG_DIR(), days);
const done = new Set(recs.filter((r) => r.kind === "paid_reconciled").map((r) => String(r.payer_key_value)));
const todo = recs.filter((r) => r.kind === "paid" && !r.skipped && !r.dry_run && !r.tx && payerKeyOf(r) && !done.has(payerKeyOf(r)!));
console.log(`reconcile: ${todo.length} paid row(s) without a tx in the last ${days} days`);
for (const r of todo) {
  const key = payerKeyOf(r)!;
  const want = { payer: String(r.payer), payTo: String(r.pay_to), amount: BigInt(String(r.amount)) };
  const found =
    r.chain === "solana"
      ? await findSolanaPayment(want.payer, key, 1, 200).then((f) => f && { tx: f.signature, check: checkSolanaTransfer(f.tx, want) })
      : await findBasePayment(want.payer, key, 1, new Date(r.ts)).then((f) => f && { tx: f.hash, check: checkBaseTransfer(f.receipt, want) });
  if (!found) {
    console.log(`  ${r.host} ${r.ts}: no payment on chain`);
    continue;
  }
  append(LOG_DIR(), {
    kind: "paid_reconciled", host: r.host, of_ts: r.ts, chain: r.chain, payer_key_value: key,
    tx: found.tx, onchain_ok: found.check.ok, onchain_detail: found.check.reason, settled_by: found.check.fee_payer ?? null,
  });
  console.log(`  ${r.host} ${r.ts}: tx ${found.tx} (${found.check.reason})`);
}
