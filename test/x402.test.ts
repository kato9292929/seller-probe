import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { judge402 } from "../src/probe-free.js";
import { fieldProblems, parse402, primaryAccept } from "../src/x402.js";

const jinHeaders = new Map(
  readFileSync(new URL("./fixtures/jin-402-headers.txt", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes(": "))
    .map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 2)] as [string, string]),
);
const getJin = (n: string) => jinHeaders.get(n.toLowerCase()) ?? null;

const v1Body = JSON.stringify({
  x402Version: 1,
  error: "X-PAYMENT header is required",
  accepts: [
    {
      scheme: "exact", network: "base", maxAmountRequired: "5000", resource: "https://seller.example/api/x",
      description: "", mimeType: "application/json", payTo: "0x1111111111111111111111111111111111111111",
      maxTimeoutSeconds: 60, asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", extra: { name: "USD Coin", version: "2" },
    },
  ],
});

test("v2 PAYMENT-REQUIRED header (live JIN capture)", () => {
  const p = parse402(getJin, "{}");
  assert.equal(p.spec_version, "v2");
  assert.equal(p.source, "header");
  const a = primaryAccept(p)!;
  assert.equal(a.chain, "solana");
  assert.equal(a.amount, "10000");
  assert.equal(a.resource, "https://jin.x402jp.com/api/jin/series");
  assert.deepEqual(fieldProblems(a), []);
});

test("v1 body, Base USDC with lowercase address", () => {
  const r = judge402({ kind: "free", host: "seller.example", url: "https://seller.example/api/x" }, 402, () => null, v1Body, 321, () => null);
  assert.equal(r.spec_version, "v1");
  assert.equal(r.fields_valid, true);
  assert.equal(r.asset_known, true);
  assert.equal(r.chain, "base");
  assert.equal(r.amount, "5000");
  assert.equal(r.latency_402_ms, 321);
  assert.equal(r.payto_stable, null, "first observation has nothing to compare");
});

test("payto_stable compares with the previous payTo on the same chain", () => {
  const base = { kind: "free" as const, host: "seller.example", url: "https://seller.example/api/x" };
  assert.equal(judge402(base, 402, () => null, v1Body, 1, () => "0x1111111111111111111111111111111111111111").payto_stable, true);
  assert.equal(judge402(base, 402, () => null, v1Body, 1, () => "0x2222222222222222222222222222222222222222").payto_stable, false);
});

test("non-402 fails status_402, fields_valid and asset_known", () => {
  const r = judge402({ kind: "free", host: "h", url: "https://h/" }, 200, () => null, "ok", 50, () => null);
  assert.deepEqual([r.reachable, r.status_402, r.fields_valid, r.asset_known, r.latency_402_ms], [true, false, false, false, null]);
});

test("unknown asset and missing fields are reported", () => {
  const body = JSON.parse(v1Body);
  body.accepts[0].asset = "0x2222222222222222222222222222222222222222";
  delete body.accepts[0].payTo;
  const r = judge402({ kind: "free", host: "h", url: "https://h/" }, 402, () => null, JSON.stringify(body), 50, () => null);
  assert.equal(r.asset_known, false);
  assert.equal(r.fields_valid, false);
  assert.ok(r.field_problems.includes("payTo missing"));
});

test("non-mainnet network is not a Solana/Base accept", () => {
  const body = JSON.parse(v1Body);
  body.accepts[0].network = "base-sepolia";
  const r = judge402({ kind: "free", host: "h", url: "https://h/" }, 402, () => null, JSON.stringify(body), 50, () => null);
  assert.equal(r.fields_valid, false);
  assert.equal(r.chain, null);
});

test("garbage 402", () => {
  const p = parse402(() => null, "<html>");
  assert.equal(p.spec_version, null);
  assert.ok(p.error);
});
