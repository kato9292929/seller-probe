import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { spentFrom } from "../src/budget.js";
import { makePayer } from "../src/pay.js";
import { probePaid, toRecord } from "../src/probe-paid.js";
import { scoreHosts, type Weights } from "../src/score.js";

const w: Weights = JSON.parse(readFileSync(new URL("../config/weights.json", import.meta.url), "utf8"));
const now = new Date("2026-10-20T00:00:00Z");
const free = { ts: "2026-10-19T00:00:00Z", host: "a", kind: "free", reachable: true, status_402: true, fields_valid: true, asset_known: true, payto_stable: true, latency_402_ms: 500 };

test("dry-run rows change neither the score nor the 7-day spend", () => {
  const dry = { ts: "2026-10-19T01:00:00Z", host: "a", kind: "paid", dry_run: true, skipped: null, settle_ok: false, onchain_ok: false, delivered: false, not_delivered: true };
  const dryAttempt = { ts: "2026-10-19T01:00:00Z", host: "a", kind: "paid_attempt", dry_run: true, amount: "10000" };
  const base = scoreHosts([free] as any, w, now);
  const withDry = scoreHosts([free, dry] as any, w, now);
  assert.deepEqual(withDry, base);
  assert.equal(withDry[0].coverage, "free_only");
  assert.equal(spentFrom([dryAttempt] as any, now), 0n);
});

function seller402(amount: string) {
  let requests = 0;
  const doc = {
    x402Version: 2,
    resource: { url: "http://127.0.0.1/x", description: "", mimeType: "application/json" },
    accepts: [{
      scheme: "exact", network: "eip155:8453", amount, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" },
    }],
  };
  const srv = createServer((req, res) => {
    requests++;
    if (req.headers["payment-signature"] || req.headers["x-payment"]) {
      res.statusCode = 200;
      return res.end("{\"paid\":true}");
    }
    res.statusCode = 402;
    res.setHeader("payment-required", Buffer.from(JSON.stringify(doc)).toString("base64"));
    res.end("{}");
  });
  return { srv, requests: () => requests };
}

async function dryRunAgainst(amount: string) {
  process.env.PROBE_EVM_PRIVATE_KEY = generatePrivateKey();
  delete process.env.PROBE_SOLANA_SECRET_KEY;
  const logDir = mkdtempSync(join(tmpdir(), "probe-dry-"));
  process.env.PROBE_LOG_DIR = logDir;
  process.env.PROBE_SELF_CHECK_DIR = logDir;
  const s = seller402(amount);
  await new Promise<void>((r) => s.srv.listen(0, "127.0.0.1", r));
  const port = (s.srv.address() as any).port;
  try {
    const r = await probePaid(
      { host: "127.0.0.1", url: `http://127.0.0.1:${port}/x`, endpoint_id: "t", price_usd: 0, networks: [] },
      { payer: await makePayer(), logDir, attemptKind: "paid_attempt", resultKind: "paid", dryRun: true },
    );
    return { r, requests: s.requests(), logFiles: readdirSync(logDir) };
  } finally {
    s.srv.close();
    delete process.env.PROBE_LOG_DIR;
    delete process.env.PROBE_SELF_CHECK_DIR;
  }
}

test("dry-run: fetches the 402, passes the cap, signs, sends nothing, logs no header", async () => {
  const { r, requests, logFiles } = await dryRunAgainst("5000");
  assert.equal(requests, 1, "only the unpaid GET reached the seller");
  assert.deepEqual(logFiles, [], "no paid_attempt row (nothing counts against the budget)");
  assert.equal(r.dry_run, true);
  assert.deepEqual(r.cap_check, { pass: true, reason: null });
  assert.equal(r.amount, "5000");
  assert.equal(r.network, "eip155:8453");
  assert.match(r.payer_key!.authorization_nonce, /^0x[0-9a-f]{64}$/);
  assert.match(r.payer_key!.authorization_signature_sha256, /^[0-9a-f]{64}$/);
  const rec = JSON.stringify(toRecord(r));
  assert.ok(!/authorization_signature"|payment-signature|x-payment|"transaction"/i.test(rec), rec);
  assert.equal(r._payment_headers, undefined);
});

test("dry-run: an offer above $0.01 is rejected by the cap and not signed", async () => {
  const { r, requests } = await dryRunAgainst("10001");
  assert.equal(requests, 1);
  assert.equal(r.cap_check?.pass, false);
  assert.match(r.cap_check!.reason!, /per-call cap/);
  assert.equal(r.payer_key, null);
  assert.equal(r.amount, "10001");
});
