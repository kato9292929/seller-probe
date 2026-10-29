import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { facilitatorFromExtra } from "../src/facilitator.js";
import { eip712Fill, makePayer, refuseReason, signFor } from "../src/pay.js";
import { selfTargets } from "../src/self-check.js";
import { parse402, primaryAccept } from "../src/x402.js";

const doc = (amount: string, extra: Record<string, unknown> = { name: "USD Coin", version: "2" }) => ({
  x402Version: 2,
  resource: { url: "https://seller.example/x", description: "", mimeType: "application/json" },
  accepts: [
    { scheme: "exact", network: "eip155:8453", amount, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60, extra },
    { scheme: "exact", network: "eip155:8453", amount: "999999", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x3333333333333333333333333333333333333333", maxTimeoutSeconds: 60, extra },
  ],
});
const parsedOf = (d: unknown) => parse402((n) => (n === "payment-required" ? Buffer.from(JSON.stringify(d)).toString("base64") : null), "");

test("refuses above $0.01, non-USDC, non-exact, Permit2, or a chain without a wallet", () => {
  const addr = { solana: null, base: "0xabc" };
  assert.equal(refuseReason(primaryAccept(parsedOf(doc("10000"))), addr), null);
  assert.match(refuseReason(primaryAccept(parsedOf(doc("10001"))), addr)!, /per-call cap/);
  assert.match(refuseReason(primaryAccept(parsedOf(doc("10", { assetTransferMethod: "permit2" }))), addr)!, /EIP-3009/);
  assert.match(refuseReason(primaryAccept(parsedOf(doc("10"))), { solana: "x", base: null })!, /no base probe wallet/);
  const d = doc("10");
  d.accepts[0].asset = "0x4444444444444444444444444444444444444444";
  d.accepts[1].asset = d.accepts[0].asset;
  assert.match(refuseReason(primaryAccept(parsedOf(d)), addr)!, /not official USDC/);
});

test("signs an EIP-3009 authorization for exactly the chosen accept (offline)", async () => {
  process.env.PROBE_EVM_PRIVATE_KEY = generatePrivateKey();
  delete process.env.PROBE_SOLANA_SECRET_KEY;
  const payer = await makePayer();
  const p = parsedOf(doc("5000"));
  const s = await signFor(payer, p, primaryAccept(p)!);
  assert.ok(s.headers["PAYMENT-SIGNATURE"], JSON.stringify(Object.keys(s.headers)));
  const auth = s.payload.payload.authorization;
  assert.equal(String(auth.value), "5000");
  assert.equal(auth.to.toLowerCase(), "0x2222222222222222222222222222222222222222");
  assert.equal(auth.from, payer.address.base);
  assert.match(s.payer_key.authorization_nonce, /^0x[0-9a-f]{64}$/);
});

test("facilitator from extra", () => {
  assert.deepEqual(facilitatorFromExtra({ feePayer: "Fp" }, { Fp: "PayAI" }), { facilitator: "PayAI", by: "extra.feePayer", fee_payer: "Fp" });
  assert.equal(facilitatorFromExtra({ feePayer: "Fp" }, {}).facilitator, "feePayer:Fp");
  assert.equal(facilitatorFromExtra({ facilitatorUrl: "https://x402.org/facilitator" }, {}).facilitator, "x402.org");
  assert.equal(facilitatorFromExtra(undefined, {}).facilitator, "unknown");
});

test("self-check refuses any host that is not ours", () => {
  process.env.OSD_PAID_URL = "https://third-party.example/paid";
  assert.throws(() => selfTargets(), /not on an own host/);
  delete process.env.OSD_PAID_URL;
  assert.deepEqual(selfTargets().map((s) => s.url), ["https://jin.x402jp.com/api/jin/series", "https://osd.x402jp.com/api/alpha/portfolio/current"]);
});

test("an offer of amount 0 is refused: there is nothing to buy", () => {
  assert.match(refuseReason(primaryAccept(parsedOf(doc("0"))), { solana: null, base: "0xabc" })!, /nothing to buy/);
});

test("official USDC on Base without EIP-712 name/version: the known domain is filled in and flagged", async () => {
  process.env.PROBE_EVM_PRIVATE_KEY = generatePrivateKey();
  delete process.env.PROBE_SOLANA_SECRET_KEY;
  const payer = await makePayer();
  const bare = parsedOf(doc("1000", {}));
  assert.deepEqual(eip712Fill(primaryAccept(bare)!), { name: "USD Coin", version: "2" });
  const s = await signFor(payer, bare, primaryAccept(bare)!);
  assert.equal(s.eip712_filled, true);
  assert.equal(String(s.payload.payload.authorization.value), "1000");
  const full = parsedOf(doc("1000"));
  assert.equal(eip712Fill(primaryAccept(full)!), null);
  assert.equal((await signFor(payer, full, primaryAccept(full)!)).eip712_filled, false);
});

test("a non-USDC asset is never filled", () => {
  const a = primaryAccept(parsedOf(doc("1000", {})))!;
  assert.equal(eip712Fill({ ...a, asset: "0x1111111111111111111111111111111111111111" }), null);
});
