import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { curatedReport } from "../src/curated/publish.js";
import { type TxCheck, type WalletRecord, publicRecords, settledBy, tallyDelivered } from "../src/curated/wallet.js";

const map = { PAYAI_FP: "PayAI", CB_FP: "Coinbase" };
const rec = (over: Partial<WalletRecord>): WalletRecord => ({
  seller: "s", host: "h", endpoint: null, network: "solana", wallet: "Phantom", fee_payer: "PAYAI_FP", amount_usd: 0.01,
  outcome: "delivered", reason: null, tx: "sig1", attempted_at: null, source: "owner_verification", ...over,
});
const final: TxCheck = { finalized: true, error: null, block_time: "2026-11-26T04:00:00.000Z" };

test("who settled: PayAI named (its /supported), others shortened; Base shows the settle sender, unnamed", () => {
  assert.equal(settledBy({ network: "solana", fee_payer: "PAYAI_FP" }, map, ["PayAI"]), "PayAI");
  assert.equal(settledBy({ network: "solana", fee_payer: "CB_FP_LONGADDRESS" }, { CB_FP_LONGADDRESS: "Coinbase" }, ["PayAI"]), "CB_FP…", "named only from /supported");
  assert.equal(settledBy({ network: "solana", fee_payer: "2hjRxUkyYRGGjKTVZc5hxss7ZmdXZfZKHgvKYneyVQaU" }, map, ["PayAI"]), "2hjRx…");
  assert.equal(settledBy({ network: "base", fee_payer: null, settle_sender: "0xB87E1A2cc2B4643F2892768e80e41167F17C5860" }, map, ["PayAI"]), "0xB87E…");
});

test("only delivered payments with a tx final on chain are published; failures and unconfirmed are left out", () => {
  const records = [
    rec({}),
    rec({ tx: "sig2" }),
    rec({ outcome: "facilitator_rejected", reason: "fee_payer_transferring_funds", tx: null, fee_payer: "CB_FP" }),
    rec({ outcome: "seller_error", reason: "503", tx: null }),
    rec({ network: "base", wallet: "Rabby", wallet_account: "eoa", fee_payer: null, settle_sender: "0xa32cCda98ba7529705a059Bd2d213Da8de10d101", tx: "0xbase" }),
  ];
  const checks = new Map<string, TxCheck>([["sig1", final], ["sig2", { finalized: false, error: "not found", block_time: null }], ["0xbase", final]]);
  const out = publicRecords(records, checks, map, ["PayAI"], "2026-11-26T06:00:00Z");
  assert.deepEqual(out.map((r) => r.tx), ["sig1", "0xbase"]);
  assert.equal(out[0].attempted_at, "2026-11-26T04:00:00.000Z", "time from the chain when the record has none");
  assert.deepEqual([out[1].wallet_account, out[1].facilitator], ["eoa", "0xa32c…"]);
  assert.deepEqual(tallyDelivered(out).map((t) => [t.facilitator, t.delivered]), [["0xa32c…", 1], ["PayAI", 1]]);
  for (const r of out) for (const k of Object.keys(r)) assert.ok(!/reason|outcome|payer|authority|^from$|request_id|approve|header|precheck|outlook/i.test(k), k);
});

test("the published file holds the 8 successful payments and nothing else", () => {
  const d = JSON.parse(readFileSync(new URL("../targets/wallet-payments.json", import.meta.url), "utf8"));
  assert.equal(d.records.length, 8);
  assert.deepEqual(d.records.map((r: any) => r.seller), ["Nansen", "Tanod", "citable.run", "solpulsedata", "Losbeto", "Xynaptic", "Agent Data", "NZ Data"]);
  assert.ok(d.records.every((r: any) => r.verified_onchain.finalized === true));
  assert.ok(!JSON.stringify(d).match(/fee_payer_transferring_funds|BlockhashNotFound|upstream_unavailable|wallet_precheck|outlook/));
  // the failed attempts stay in the config as records
  const src = JSON.parse(readFileSync(new URL("../config/wallet-payments.json", import.meta.url), "utf8"));
  assert.ok(src.records.some((r: WalletRecord) => r.outcome !== "delivered"));
});

test("curated.json carries no wallet_precheck and the cards no Phantom outlook", () => {
  const curated = JSON.parse(readFileSync(new URL("../targets/curated.json", import.meta.url), "utf8"));
  const r = curatedReport({ records: [], selfChecks: [], curated, now: new Date("2026-11-26T00:00:00Z") });
  const s = JSON.stringify(r);
  assert.ok(!s.includes("wallet_precheck") && !s.includes("phantom"));
});
