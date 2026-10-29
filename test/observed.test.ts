import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { OBSERVED_TTL_DAYS, observedInputRequirement, observedRequirements } from "../src/observed.js";
import { makePayer, signFor } from "../src/pay.js";
import { parse402, primaryAccept } from "../src/x402.js";

// The four request_rejected rows of the 2026-10-26 paid probe, as logged.
const rej: Record<string, any> = JSON.parse(readFileSync(new URL("./fixtures/rejected-2026-10-26.json", import.meta.url), "utf8"));

test("structured fields only: missing list, missing-input code (+parameter), 402 'use POST'", () => {
  assert.equal(observedInputRequirement(rej["api.loyalspark.online"])?.reason, "missing: token_address, customer_address");
  assert.equal(observedInputRequirement(rej["api.agents-trust.com"])?.reason, "code MISSING_PARAMETER: url");
  assert.equal(observedInputRequirement(rej["x402.freeq.one"])?.reason, "method POST (402 error)");
  assert.equal(observedInputRequirement(rej["api.geekvault.dev"]), null, "payment_identifier_required is not a missing input");
});

test("the evidence keeps the error body it was based on", () => {
  const o = observedInputRequirement(rej["api.loyalspark.online"])!;
  assert.equal(o.evidence.http_status, 400);
  assert.match(o.evidence.error!, /"error_code":"missing_fields"/);
});

test("free-text wording alone is not enough", () => {
  const r = { ...rej["api.agents-trust.com"], error_body: '{"error":"please pass a url parameter, it is missing"}' };
  assert.equal(observedInputRequirement(r), null);
  const delivered = { ...rej["api.loyalspark.online"], tx: "abc", http_status: 200, response_bytes: 10 };
  assert.equal(observedInputRequirement(delivered), null, "only purchases that did not happen count");
});

test("a host is kept out for 4 weeks after the observation, then measured again; a later purchase clears it", () => {
  const r = rej["api.loyalspark.online"]; // 2026-10-26
  const within = observedRequirements([r] as any, new Date("2026-11-20T00:00:00Z"));
  assert.ok(within.has("api.loyalspark.online"));
  assert.equal(within.get("api.loyalspark.online")!.until.slice(0, 10), "2026-11-23");
  const after = observedRequirements([r] as any, new Date(Date.parse(r.ts) + (OBSERVED_TTL_DAYS + 1) * 86_400_000));
  assert.equal(after.size, 0);
  const later = { ...r, ts: "2026-11-02T10:00:00Z", http_status: 200, tx: "abc", response_bytes: 50, x402_error: null, error_body: null };
  assert.equal(observedRequirements([r, later] as any, new Date("2026-11-03T00:00:00Z")).size, 0);
});

test("payment-identifier: when the seller declares it, the payment carries a valid id", async () => {
  process.env.PROBE_EVM_PRIVATE_KEY = generatePrivateKey();
  delete process.env.PROBE_SOLANA_SECRET_KEY;
  const doc = {
    x402Version: 2,
    resource: { url: "https://s.example/x" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } }],
    extensions: { "payment-identifier": { info: { required: true }, schema: { type: "object" } } },
  };
  const p = parse402((n) => (n === "payment-required" ? Buffer.from(JSON.stringify(doc)).toString("base64") : null), "");
  const s = await signFor(await makePayer(), p, primaryAccept(p)!);
  const id = s.payload.extensions["payment-identifier"].info.id;
  assert.match(id, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(s.payer_key.payment_identifier, id);
  const sent = JSON.parse(Buffer.from(s.headers["PAYMENT-SIGNATURE"], "base64").toString("utf8"));
  assert.equal(sent.extensions["payment-identifier"].info.id, id, "the id is in the header that is sent");
  // Without the declaration nothing is added.
  const plain = parse402((n) => (n === "payment-required" ? Buffer.from(JSON.stringify({ ...doc, extensions: undefined })).toString("base64") : null), "");
  const s2 = await signFor(await makePayer(), plain, primaryAccept(plain)!);
  assert.equal(s2.payer_key.payment_identifier, undefined);
});

test("401 → auth (observed); 405 and INVALID_INPUT → input (observed); 404 and free text are not used", () => {
  const row = (http_status: number, error_body: string) => ({ kind: "paid", ts: "2026-10-28T10:00:00Z", host: "h", skipped: null, tx: null, http_status, error_body });
  assert.deepEqual([observedInputRequirement(row(401, '{"message":"Unauthorized"}'))?.kind, observedInputRequirement(row(401, ""))?.reason], ["auth", "HTTP 401"]);
  assert.equal(observedInputRequirement(row(405, '{"error":"method_not_allowed"}'))?.kind, "input");
  assert.equal(observedInputRequirement(row(400, '{"error_code":"INVALID_INPUT","message":"Both id and id_type are required"}'))?.reason, "code INVALID_INPUT");
  assert.equal(observedInputRequirement(row(400, '{"error":{"code":"missing_param","message":"at least one of search_query"}}'))?.reason, "code missing_param");
  assert.equal(observedInputRequirement(row(404, '{"error":{"message":"No API route matches /api/v1/candles."}}')), null);
  assert.equal(observedInputRequirement(row(400, '{"error":"address required"}')), null);
});
