import assert from "node:assert/strict";
import { test } from "node:test";
import { screenPaidTargets } from "../src/targets.js";
import { inputRequirement, parse402 } from "../src/x402.js";

const doc402 = (extra: Record<string, unknown>, accept: Record<string, unknown> = {}) =>
  parse402(
    (n) => (n === "payment-required" ? Buffer.from(JSON.stringify({
      x402Version: 2, resource: { url: "https://s.example/x" },
      accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x2222222222222222222222222222222222222222", ...accept }],
      ...extra,
    })).toString("base64") : null),
    "",
  );

// Shapes taken from the live 402s of 2026-10-23.
const input = (props: Record<string, unknown>) => ({ extensions: { bazaar: { schema: { properties: { input: { properties: props, required: ["type", "method"] } } } } } });

test("required body (chat completions) → requires_input", () => {
  const r = inputRequirement(doc402(input({ body: { type: "object", required: ["model", "messages"] } })));
  assert.deepEqual(r, { requires: true, reason: "body: model, messages", source: "bazaar" });
});

test("POST-only method → requires_input", () => {
  assert.equal(inputRequirement(doc402(input({ method: { enum: ["POST", "PUT"] } }))).reason, "method POST/PUT");
  assert.equal(inputRequirement(doc402({ extensions: { bazaar: { info: { input: { method: "POST", body: { a: 1 } } } } } })).reason, "method POST");
});

test("required query parameter → requires_input; optional ones do not", () => {
  const sniper = input({ method: { enum: ["GET"] }, queryParams: { type: "object", properties: { token_address: {} }, required: ["token_address"] } });
  assert.equal(inputRequirement(doc402(sniper)).reason, "query: token_address");
  const optional = input({ method: { enum: ["GET"] }, queryParams: { properties: { limit: { type: "string" } } } });
  assert.equal(inputRequirement(doc402(optional)).requires, false);
  const anyGet = input({ method: { enum: ["GET", "HEAD", "DELETE"] }, queryParams: { additionalProperties: { type: "string" } } });
  assert.equal(inputRequirement(doc402(anyGet)).requires, false);
});

test("x402 v1 outputSchema with a required query field → requires_input", () => {
  const r = inputRequirement(doc402({}, { outputSchema: { input: { type: "http", method: "GET", queryParams: { q: { type: "string", required: true } } } } }));
  assert.deepEqual(r, { requires: true, reason: "query: q", source: "outputSchema" });
});

test("no schema at all → stays a target", () => {
  assert.deepEqual(inputRequirement(doc402({})), { requires: false, reason: null, source: null });
});

test("screening drops requires_input hosts and promotes the next ones up to top_n", async () => {
  const t = (host: string, rank: number) => ({ host, url: `https://${host}/`, endpoint_id: host, price_usd: 0.001, networks: ["Base"], tx_count: 100 - rank, rank });
  const cands = Array.from({ length: 14 }, (_, i) => t(`h${i}`, i + 1));
  const file: any = { paid: { top_n: 10, random_n: 0, top: cands.slice(0, 10), random: [], skipped_popular: [], top_candidates: cands, random_candidates: [] } };
  const needs = new Set(["h0", "h3", "h7"]);
  const out = await screenPaidTargets(file, async (c) => (needs.has(c.host) ? { requires: true, reason: "body: x" } : { requires: false, reason: null }));
  assert.equal(out.paid.top.length, 10);
  assert.deepEqual(out.paid.top.map((x: any) => x.host), ["h1", "h2", "h4", "h5", "h6", "h8", "h9", "h10", "h11", "h12"]);
  assert.deepEqual(out.paid.screened!.requires_input.map((d) => d.host), ["h0", "h3", "h7"]);
  assert.ok(out.paid.skipped_popular.every((s: any) => s.reason.startsWith("requires_input")));
});
