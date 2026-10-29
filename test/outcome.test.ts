import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { classifyPaid } from "../src/outcome.js";
import { makePayer } from "../src/pay.js";
import { judge402 } from "../src/probe-free.js";
import { probePaid } from "../src/probe-paid.js";
import { type Weights, scoreHosts } from "../src/score.js";

const w: Weights = JSON.parse(readFileSync(new URL("../config/weights.json", import.meta.url), "utf8"));
const now = new Date("2026-10-20T00:00:00Z");
const free = { ts: "2026-10-19T00:00:00Z", host: "a", kind: "free", reachable: true, status_402: true, fields_valid: true, asset_known: true, payto_stable: true, latency_402_ms: 500 };
// Shape of a 2026-10-19 paid row (written before `outcome` existed).
const paidRow = (over: Record<string, unknown>) => ({
  ts: "2026-10-19T10:20:00Z", host: "a", kind: "paid", skipped: null, http_status: 402, settle_ok: false, onchain_ok: false,
  delivered: false, not_delivered: false, tx: null, response_bytes: 2, latency_paid_ms: 65, cache_header: null, ...over,
});

test("classify: no transfer + 400 / 402 → request_rejected; transfer + 400 → not_delivered; transfer + 200 → delivered", () => {
  assert.equal(classifyPaid(paidRow({ http_status: 400 })), "request_rejected");
  assert.equal(classifyPaid(paidRow({ http_status: 402 })), "request_rejected");
  assert.equal(classifyPaid(paidRow({ http_status: 400, tx: "2KD6f", settle_ok: true, onchain_ok: true, not_delivered: true })), "not_delivered");
  assert.equal(classifyPaid(paidRow({ http_status: 200, tx: "0xfe99", settle_ok: true, onchain_ok: true, delivered: true, response_bytes: 120 })), "delivered");
  assert.equal(classifyPaid(paidRow({ http_status: 200, tx: "0xfe99", response_bytes: 0 })), "not_delivered", "empty body after paying");
  assert.equal(classifyPaid(paidRow({ http_status: 503 })), "failed");
  assert.equal(classifyPaid(paidRow({ skipped: "requires_input: method POST" })), null);
  assert.equal(classifyPaid(paidRow({ dry_run: true })), null);
});

test("no-transfer 400 and 402 are not counted as failures (old rows read the same way)", () => {
  const base = scoreHosts([free] as any, w, now)[0];
  const [s] = scoreHosts([free, paidRow({ http_status: 400 }), paidRow({ http_status: 402, ts: "2026-10-19T10:21:00Z" })] as any, w, now);
  assert.equal(s.score, base.score, "score unchanged");
  assert.equal(s.coverage, "free_only");
  assert.equal(s.n_paid, 0);
  assert.equal(s.n_rejected, 2);
  assert.equal(s.paid_outcomes.request_rejected, 2);
  assert.equal(s.items.delivered, undefined, "no paid item exists");
  assert.equal(s.last_rejection?.http_status, 402);
});

test("transfer + 400 stays not_delivered and lowers the score", () => {
  const [s] = scoreHosts([free, paidRow({ http_status: 400, tx: "2KD6f", settle_ok: true, onchain_ok: true, not_delivered: true })] as any, w, now);
  assert.equal(s.coverage, "full");
  assert.equal(s.n_paid, 1);
  assert.equal(s.n_rejected, 0);
  assert.equal(s.paid_outcomes.not_delivered, 1);
  assert.equal(s.items.not_delivered.value, 0);
  assert.ok(s.score! < 100);
});

test("free probe keeps the first 300 characters of a non-402 body", () => {
  const body = "<html>" + "x".repeat(500);
  const r = judge402({ kind: "free", host: "h", url: "https://h/" }, 404, () => null, body, 10, () => null);
  assert.equal(r.error_body!.length, 300);
  assert.ok(r.error_body!.startsWith("<html>"));
  const ok = judge402({ kind: "free", host: "h", url: "https://h/" }, 402, () => null, "{}", 10, () => null);
  assert.equal(ok.error_body, null);
});

// A local seller on Base: answers the unpaid GET with a 402, and the paid GET with `paid`.
async function seller(paid: (res: import("node:http").ServerResponse) => void, extensions?: unknown) {
  const doc = {
    x402Version: 2,
    resource: { url: "http://127.0.0.1/x", description: "", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } }],
    ...(extensions ? { extensions } : {}),
  };
  const srv = createServer((req, res) => {
    if (req.headers["payment-signature"]) return paid(res);
    res.statusCode = 402;
    res.setHeader("payment-required", Buffer.from(JSON.stringify(doc)).toString("base64"));
    res.end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, url: `http://127.0.0.1:${(srv.address() as any).port}/x`, doc };
}

async function buy(url: string) {
  process.env.PROBE_EVM_PRIVATE_KEY = generatePrivateKey();
  delete process.env.PROBE_SOLANA_SECRET_KEY;
  const dir = mkdtempSync(join(tmpdir(), "probe-out-"));
  process.env.PROBE_LOG_DIR = dir;
  process.env.PROBE_SELF_CHECK_DIR = dir;
  process.env.PROBE_FIND_TIMEOUT_MS = "0"; // no chain search in tests
  try {
    return await probePaid({ host: "127.0.0.1", url, endpoint_id: "t", price_usd: 0, networks: [] },
      { payer: await makePayer(), logDir: dir, attemptKind: "paid_attempt", resultKind: "paid" });
  } finally {
    for (const k of ["PROBE_LOG_DIR", "PROBE_SELF_CHECK_DIR", "PROBE_FIND_TIMEOUT_MS"]) delete process.env[k];
  }
}

test("paid probe records the 402 error and body when the paid request is rejected without a transfer", async () => {
  const s = await seller((res) => {
    res.statusCode = 402;
    const again = { x402Version: 2, error: "invalid_exact_evm_payload_signature", accepts: [] };
    res.setHeader("payment-required", Buffer.from(JSON.stringify(again)).toString("base64"));
    res.end('{"error":"invalid signature"}');
  });
  try {
    const r = await buy(s.url);
    assert.equal(r.http_status, 402);
    assert.equal(r.x402_error, "invalid_exact_evm_payload_signature");
    assert.equal(r.error_body, '{"error":"invalid signature"}');
    assert.equal(r.tx, null);
    assert.equal(r.outcome, "request_rejected");
  } finally {
    s.srv.close();
  }
});

test("paid probe does not buy an endpoint whose 402 declares a required input", async () => {
  const ext = { bazaar: { schema: { properties: { input: { properties: { method: { enum: ["POST"] } } } } } } };
  let paidCalls = 0;
  const s = await seller((res) => {
    paidCalls++;
    res.end("x");
  }, ext);
  try {
    const r = await buy(s.url);
    assert.match(r.skipped!, /^requires_input: method POST/);
    assert.equal(r.outcome, null);
    assert.equal(paidCalls, 0);
  } finally {
    s.srv.close();
  }
});

test("paid probe never buys from an excluded seller, even if it is in the targets file", async () => {
  let calls = 0;
  const srv = createServer((_req, res) => {
    calls++;
    res.statusCode = 402;
    res.end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try {
    process.env.PROBE_EVM_PRIVATE_KEY = generatePrivateKey();
    const r = await probePaid(
      { host: "x402-solana-lottery.alexwlex143.workers.dev", url: `http://127.0.0.1:${(srv.address() as any).port}/x`, endpoint_id: "t", price_usd: 0, networks: [] },
      { payer: await makePayer(), logDir: mkdtempSync(join(tmpdir(), "probe-ex-")), attemptKind: "paid_attempt", resultKind: "paid" },
    );
    assert.equal(r.skipped, "excluded: gambling");
    assert.equal(calls, 0, "not even the unpaid GET");
  } finally {
    srv.close();
  }
});

test("a 200 without a settlement header, reconciled with the tx found on chain, reads as delivered (settle_ok stays false)", async () => {
  const { applyReconciliations } = await import("../src/outcome.js");
  const glim = paidRow({
    host: "a", http_status: 200, response_bytes: 2084, delivered: true, settle_ok: false, onchain_ok: false, tx: null,
    payer_key: { payer_signature: "5qqTgC" }, outcome: "failed",
  });
  const fix = { ts: "2026-10-26T13:10:00Z", kind: "paid_reconciled", host: "a", payer_key_value: "5qqTgC", tx: "4P1SHy", onchain_ok: true, onchain_detail: "USDC transfer matches 402" };
  const [merged] = applyReconciliations([glim, fix] as any[]).filter((r: any) => r.kind === "paid");
  assert.equal(classifyPaid(merged), "delivered");
  const [s] = scoreHosts([free, glim, fix] as any, w, now);
  assert.equal(s.paid_outcomes.delivered, 1);
  assert.equal(s.paid_outcomes.failed, 0);
  assert.equal(s.items.settle_ok.value, 0, "the missing header still counts against settle_ok");
  assert.equal(s.items.onchain_ok.value, 1);
});

test("200 with a body but no settlement and nothing on chain → delivered_unsettled; a paid_resolution re-reads an old row", async () => {
  const { applyReconciliations, outcomeOf } = await import("../src/outcome.js");
  const base = { kind: "paid", ts: "2026-10-28T09:51:24Z", host: "money-reactor.example", skipped: null, tx: null, response_bytes: 71, payer_key: { authorization_nonce: "0xabc" } };
  assert.equal(classifyPaid({ ...base, http_status: 200 }), "delivered_unsettled");
  assert.equal(classifyPaid({ ...base, http_status: 200, response_bytes: 0 }), "failed");
  assert.equal(classifyPaid({ ...base, http_status: 502 }), "failed");
  const old = { ...base, http_status: 200, outcome: "failed" };
  const res = { kind: "paid_resolution", ts: "2026-10-29T00:00:00Z", host: base.host, payer_key_value: "0xabc", outcome: "delivered_unsettled", basis: "b" };
  const [r] = applyReconciliations([old, res] as any[]);
  assert.equal(outcomeOf(r), "delivered_unsettled");
  assert.deepEqual((r as any).resolution, { at: res.ts, basis: "b" });
});
