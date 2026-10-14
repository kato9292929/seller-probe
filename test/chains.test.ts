import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBaseTransfer } from "../src/chains/base.js";
import { checkSolanaTransfer } from "../src/chains/solana.js";
import { USDC } from "../src/config.js";

const PAYER = "Payer1111111111111111111111111111111111111";
const PAYTO = "PayTo111111111111111111111111111111111111";
const bal = (owner: string, amount: string, mint = USDC.solana) => ({ owner, mint, uiTokenAmount: { amount } });

test("solana: exact USDC delta payer → payTo", () => {
  const tx = {
    slot: 1,
    transaction: { message: { accountKeys: [{ pubkey: "Fac" }] } },
    meta: { err: null, preTokenBalances: [bal(PAYER, "50000"), bal(PAYTO, "0")], postTokenBalances: [bal(PAYER, "40000"), bal(PAYTO, "10000")] },
  };
  const c = checkSolanaTransfer(tx, { payer: PAYER, payTo: PAYTO, amount: 10_000n });
  assert.equal(c.ok, true);
  assert.equal(c.fee_payer, "Fac");
  assert.equal(checkSolanaTransfer(tx, { payer: PAYER, payTo: PAYTO, amount: 9_000n }).ok, false);
});

test("solana: failed tx or wrong mint is not ok", () => {
  const meta = { preTokenBalances: [bal(PAYER, "50000", "Other")], postTokenBalances: [bal(PAYER, "40000", "Other"), bal(PAYTO, "10000", "Other")] };
  assert.equal(checkSolanaTransfer({ meta: { ...meta, err: null } }, { payer: PAYER, payTo: PAYTO, amount: 10_000n }).ok, false);
  assert.equal(checkSolanaTransfer({ meta: { err: { InstructionError: [0, "x"] } } }, { payer: PAYER, payTo: PAYTO, amount: 1n }).ok, false);
  assert.equal(checkSolanaTransfer(null, { payer: PAYER, payTo: PAYTO, amount: 1n }).ok, false);
});

const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const from = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";

test("base: USDC Transfer log from payer to payTo with exact value", () => {
  const receipt = {
    status: "0x1", blockNumber: "0x10", from: "0xfac",
    logs: [{ address: USDC.base.toLowerCase(), topics: [T, pad(from), pad(to)], data: "0x" + (5000).toString(16).padStart(64, "0") }],
  };
  assert.equal(checkBaseTransfer(receipt, { payer: from, payTo: to, amount: 5000n }).ok, true);
  assert.equal(checkBaseTransfer(receipt, { payer: from, payTo: to, amount: 5001n }).ok, false);
  assert.equal(checkBaseTransfer({ ...receipt, status: "0x0" }, { payer: from, payTo: to, amount: 5000n }).ok, false);
  assert.equal(checkBaseTransfer({ ...receipt, logs: [{ ...receipt.logs[0], address: "0xdead" }] }, { payer: from, payTo: to, amount: 5000n }).ok, false);
});
