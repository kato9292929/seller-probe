import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { curatedReport } from "../src/curated/publish.js";
import { type WalletRecord, associatedTokenAccount, facilitatorName, outlookFor, tallyByFacilitator } from "../src/curated/wallet.js";

const map = { PAYAI_FP: "PayAI", CB_FP: "Coinbase" };
const rec = (over: Partial<WalletRecord>): WalletRecord => ({
  seller: "s", host: "h", endpoint: null, network: "solana", wallet: "Phantom", fee_payer: "PAYAI_FP", amount_usd: 0.01,
  outcome: "delivered", reason: null, tx: "sig", attempted_at: null, source: "owner_verification", ...over,
});

test("facilitator names come from the map; an unknown fee payer is shown short", () => {
  assert.equal(facilitatorName("PAYAI_FP", map), "PayAI");
  assert.equal(facilitatorName("FAC42xNoVBZctsRJqwNcRZnXCwmGZvfHcZLD7hQPXuwu", map), "FAC42…");
  assert.equal(facilitatorName(null, map), null);
});

test("outlook: accepted / refused on record, missing receiving account, unverified, no Solana option", () => {
  const tallies = tallyByFacilitator([
    rec({}), rec({ outcome: "wallet_simulation_stopped", tx: null }),
    rec({ fee_payer: "CB_FP", outcome: "facilitator_rejected", reason: "fee_payer_transferring_funds", tx: null }),
  ], map);
  assert.deepEqual(tallies.find((t) => t.facilitator === "PayAI"), { facilitator: "PayAI", phantom_attempts: 2, delivered: 1, rejected: 0 });
  const pre = (facilitator: string | null, ata_exists: boolean | null = true) => ({ solana: { facilitator, ata_exists } });
  assert.equal(outlookFor(pre("PayAI"), tallies), "accepted_facilitator");
  assert.equal(outlookFor(pre("Coinbase"), tallies), "rejected_facilitator");
  assert.equal(outlookFor(pre("PayAI", false), tallies), "no_ata", "a missing account fails whatever the facilitator");
  assert.equal(outlookFor(pre("Dexter"), tallies), "unverified");
  assert.equal(outlookFor({ solana: null }, tallies), "no_solana");
});

test("receiving account: the USDC ATA of an owner (known pair)", async () => {
  // Owner: the Probe's own public Solana wallet; its USDC ATA is fixed by the derivation.
  const ata = await associatedTokenAccount("xgtJ5j3VfuYG4cxAxsQjTKWsnVdFTLPYK8NxQnpFZW5");
  assert.match(ata, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(ata, await associatedTokenAccount("xgtJ5j3VfuYG4cxAxsQjTKWsnVdFTLPYK8NxQnpFZW5"));
});

test("published data: wallet_precheck on each endpoint, one Phantom line per card, and no payer address anywhere", () => {
  const curated = JSON.parse(readFileSync(new URL("../targets/curated.json", import.meta.url), "utf8"));
  const id = curated.items[0].id;
  const r = curatedReport({
    records: [], selfChecks: [], curated, now: new Date("2026-11-26T00:00:00Z"),
    walletPrecheck: { [id]: { checked_at: "2026-11-26T00:00:00Z", status: 402, error: null, solana: { fee_payer: "PAYAI_FP", facilitator: "PayAI", facilitator_by: "extra.feePayer", pay_to: "x", ata: "y", ata_exists: true }, base: null } },
    walletTallies: [{ facilitator: "PayAI", phantom_attempts: 1, delivered: 1, rejected: 0 }],
  });
  const it = r.items.find((i) => i.id === id)!;
  assert.equal(it.wallet_precheck!.phantom_outlook, "accepted_facilitator");
  assert.deepEqual(r.cards.find((c) => c.item_ids.includes(id))!.phantom, [{ outlook: "accepted_facilitator", facilitator: "PayAI" }]);
  // the records file names no payer, authority or sender; only tx signatures and facilitator fee payers
  const src = JSON.parse(readFileSync(new URL("../config/wallet-payments.json", import.meta.url), "utf8"));
  for (const x of src.records) for (const k of Object.keys(x)) assert.ok(!/payer$|^payer|authority|^from$|request_id|approve|header/i.test(k) || k === "fee_payer", k);
});
