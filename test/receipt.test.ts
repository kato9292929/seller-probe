import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { receiptCheck, wellKnownOf } from "../src/receipt.js";
import { base64urlEncode, encodeReceipt, receiptSigningBytes, sha256Hex } from "../src/receipt/verify.js";

// A throwaway Ed25519 key for this test only.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubRaw = publicKey.export({ format: "jwk" }).x!;
const wellKnown = { keys: [{ key_id: "k1", alg: "Ed25519" as const, public_key: pubRaw }], refetch_window_s: 604800, refetch_header: "X-Payment-Refetch" };
const body = new TextEncoder().encode('{"ok":1}');
const payload = {
  v: 1 as const, payment_id: "0xnonce", network: "eip155:8453", resource: "https://s.example/x", body_sha256: sha256Hex(body),
  content_length: body.length, issued_at: new Date().toISOString(), delivery: "first" as const, key_id: "k1",
};
const header = encodeReceipt({ ...payload, sig: base64urlEncode(new Uint8Array(sign(null, receiptSigningBytes(payload), privateKey))) });

test("receipt_ok: true when it verifies; false on a changed body or another payment; null without a receipt", async () => {
  assert.deepEqual(await receiptCheck(header, body, payload.resource, "0xnonce", wellKnown), { receipt_ok: true, receipt_reason: null });
  const bad = await receiptCheck(header, new TextEncoder().encode('{"ok":2}'), payload.resource, "0xnonce", wellKnown);
  assert.equal(bad.receipt_ok, false);
  assert.match(bad.receipt_reason!, /receipt_hash_mismatch/);
  assert.equal((await receiptCheck(header, body, payload.resource, "0xother", wellKnown)).receipt_ok, false);
  assert.deepEqual(await receiptCheck(null, body, payload.resource, "0xnonce", wellKnown), { receipt_ok: null, receipt_reason: null });
});

test("receipt_advertised: true with a key, false on 404 or no keys, null when unreachable", async () => {
  let doc: unknown = wellKnown;
  const srv = createServer((req, res) => {
    if (req.url !== "/.well-known/x402-receipt.json" || doc === null) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(doc));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as any).port}/api/x`;
  try {
    assert.equal((await wellKnownOf(url)).advertised, true);
    doc = { ...wellKnown, keys: [] };
    assert.equal((await wellKnownOf(url)).advertised, false);
    doc = null;
    assert.equal((await wellKnownOf(url)).advertised, false);
  } finally {
    srv.close();
  }
  assert.equal((await wellKnownOf("http://127.0.0.1:9/x")).advertised, null);
});
