// Successful wallet payments (targets/wallet-payments.json → /data/wallet-payments.json).
// Reads config/wallet-payments.json, checks every delivered payment's tx on chain, and publishes only
// those that are final. Failed attempts stay in the config as records and are not published.
// Pays nothing and signs nothing: RPC reads only.
//   npm run wallet
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config.js";
import { type TxCheck, type WalletRecord, publicRecords, tallyDelivered, verifyBaseTx, verifySolanaTx } from "../curated/wallet.js";
import { loadFeePayerMap } from "../facilitator.js";

const now = new Date().toISOString();
const src: { records: WalletRecord[] } = JSON.parse(readFileSync(resolve(ROOT, "config/wallet-payments.json"), "utf8"));
const fac = JSON.parse(readFileSync(resolve(ROOT, "config/facilitators.json"), "utf8"));
const named: string[] = fac.public_names ?? [];

const checks = new Map<string, TxCheck>();
for (const r of src.records) {
  if (r.outcome !== "delivered" || !r.tx) continue;
  const c = r.network === "solana" ? await verifySolanaTx(r.tx) : await verifyBaseTx(r.tx);
  checks.set(r.tx, c);
  console.log(`${r.network} ${r.seller ?? "-"} ${r.tx.slice(0, 10)}… ${c.finalized ? "final" : `NOT final (${c.error})`}`);
}
const records = publicRecords(src.records, checks, loadFeePayerMap(), named, now);
const unconfirmed = [...checks.values()].filter((c) => !c.finalized).length;
writeFileSync(
  resolve(ROOT, "targets/wallet-payments.json"),
  JSON.stringify({ generated_at: now, note: "Successful payments the owner made with a wallet through AgentPay402. No payer address is kept.", records, by_facilitator: tallyDelivered(records) }, null, 1) + "\n",
);
console.log(`published ${records.length} successful payments${unconfirmed ? `; ${unconfirmed} delivered row(s) not final on chain, left out` : ""}`);
