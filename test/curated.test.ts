import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { USDC } from "../src/config.js";
import { buyCurated } from "../src/curated/buy.js";
import { type CuratedItem, MAX_ITEMS, curate } from "../src/curated/curate.js";
import { CATEGORIES, DEFINITIONS, categorize, contentChecks } from "../src/curated/judge.js";
import { buildRequest, exampleFromDescription, fromBazaarShape, fromOpenApi, fromPaymentRequired, fromText } from "../src/curated/request.js";
import { type BazaarItem, type Operator, parseEndpointTables } from "../src/curated/sources.js";
import { makePayer } from "../src/pay.js";

const noEx = { hosts: [], patterns: [{ category: "gambling", match: ["lottery"], reason: "" }] };
const op = (host: string, over: Partial<Operator> = {}): Operator => ({ host, name: host, source: "most_called", rank: 1, tx_count: 1000, usdc_settled: 1, buyers: 50, category: "Data", ...over });
const bz = (resource: string, over: Partial<BazaarItem> = {}): BazaarItem => ({
  resource, host: new URL(resource).hostname, description: "Price data", serviceName: null,
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "5000", asset: USDC.base, payTo: "0xaaaa000000000000000000000000000000000001" }],
  input: { type: "http", method: "GET", queryParams: { symbol: "AAPL" } }, inputSchema: null, output: null, outputSchema: null, calls30d: 100, payers30d: 10, lastCalledAt: null, ...over,
});
const curateWith = (operators: Operator[], bazaar: BazaarItem[], extra: Partial<Parameters<typeof curate>[0]> = {}) =>
  curate({ operators, bazaar, sellers: new Map(), catalog: [], selfTrade: new Map(), exclusions: noEx, now: new Date("2026-11-08T00:00:00Z"), ...extra });

test("tables: Most-called rows keep tx/buyers; the host cell's ' · price · chain' suffix is dropped", () => {
  const row = (cells: string[]) => `<div class="grid grid-cols-[2.5rem_1fr_auto] x">${cells.map((c) => `<span>${c}</span>`).join("")}</div>`;
  const html =
    `<section id="providers"><p>Companies you already know</p>${row(["1", "QuickNode", "x402.quicknode.com", "142", "$0.001", "Other"])}` +
    `<p>Other providers on their own domain</p>${row(["1", "Arkham API", "api.arkm.com", "92", "$0.4", "Data"])}</div></div></div></section>` +
    `<section id="most-called">${row(["1", "AX1", "ax1.vc · 0.02 USDC · Base", "180,578", "$3,612", "1,104", "Data"])}</div></div></div></section>`;
  const ops = parseEndpointTables(html);
  const mc = ops.find((o) => o.source === "most_called")!;
  assert.deepEqual([mc.host, mc.tx_count, mc.buyers], ["ax1.vc", 180578, 1104]);
  assert.deepEqual(ops.filter((o) => o.source !== "most_called").map((o) => [o.source, o.host]), [["known_company", "x402.quicknode.com"], ["other_provider", "api.arkm.com"]]);
});

test("curate: every exclusion keeps its reason; at most 3 per operator by calls; at most 80 by calls", () => {
  const ops = [
    op("one.io", { buyers: 1 }),
    op("self.io"),
    op("demo-api.io"),
    op("quest.io", { name: "Send it on quests. Earn." }),
    op("lottery.io"),
    op("good.io"),
  ];
  const bazaar = [
    ...[1, 2, 3, 4, 5].map((i) => bz(`https://good.io/e${i}`, { calls30d: i * 10 })),
    bz("https://good.io/{id}", { calls30d: 999 }),
    bz("https://good.io/lonely", { calls30d: 998, payers30d: 1 }),
    bz("https://self.io/a"),
  ];
  const out = curateWith(ops, bazaar, { selfTrade: new Map([["self.io", { address: "0xabc", tx: "0x1" }]]) });
  const why = Object.fromEntries(out.excluded.filter((e) => e.scope === "operator").map((e) => [e.host, e.reason]));
  assert.deepEqual(why, { "one.io": "single_buyer", "self.io": "self_trade", "demo-api.io": "test_demo", "quest.io": "reward_or_resale", "lottery.io": "excluded_list" });
  assert.deepEqual(out.items.map((i) => i.url), ["https://good.io/e5", "https://good.io/e4", "https://good.io/e3"]);
  assert.ok(out.excluded.some((e) => e.reason === "template_url" && e.url === "https://good.io/{id}"));
  assert.ok(out.excluded.some((e) => e.reason === "single_buyer" && e.url === "https://good.io/lonely"));
  assert.ok(out.excluded.some((e) => e.reason === "per_operator_cap" && /2 more/.test(e.detail)));
  const it = out.items[0];
  assert.deepEqual([it.price_usd, it.reasons.operator_tx, it.reasons.operator_buyers, it.reasons.endpoint_calls_30d], [0.005, 1000, 50, 50]);

  const many = Array.from({ length: 40 }, (_, i) => op(`h${i}.io`, { tx_count: i }));
  const big = curateWith(many, many.flatMap((o, i) => [1, 2, 3].map((k) => bz(`https://${o.host}/e${k}`, { calls30d: i * 10 + k }))));
  assert.equal(big.items.length, MAX_ITEMS);
  assert.equal(big.excluded.filter((e) => e.reason === "over_max").length, 120 - MAX_ITEMS);
  assert.equal(Math.min(...big.items.map((i) => i.reasons.endpoint_calls_30d!)), 132, "the least-called are cut");
});

test("curate: hosts sharing one payTo are one operator; a payTo over 10 hosts with ≤5 buyers is a resale front", () => {
  const seller = (hosts: string[], buyers: number) => ({ hosts, titles: [], descriptions: [], tx_count: 10, unique_buyers: buyers, recipients: ["0xpay"] });
  const s = seller(["a.io", "b.io"], 40);
  const out = curateWith([op("a.io"), op("b.io", { tx_count: 10 })], [bz("https://a.io/x"), bz("https://b.io/y")], { sellers: new Map([["a.io", s], ["b.io", s]]) });
  assert.equal(out.excluded.find((e) => e.host === "b.io")?.reason, "same_pay_to");
  const front = seller(Array.from({ length: 12 }, (_, i) => `s${i}.atlas.io`), 2);
  const out2 = curateWith([op("s0.atlas.io")], [bz("https://s0.atlas.io/x")], { sellers: new Map([["s0.atlas.io", front]]) });
  assert.equal(out2.excluded[0].reason, "reward_or_resale");
});

test("request: Bazaar example values are used as given; placeholders get a representative value; keys are fresh", () => {
  const d = fromBazaarShape("bazaar", "b", { method: "GET", queryParams: { limit: 1, token_address: "example_token_address" } }, null, null, null)!;
  const r = buildRequest("https://x.io/api", { from402: null, x402Endpoint: null, bazaar: d, docs: null }, { description: "Solana token activity", today: "2026-11-08" });
  assert.ok(r.ok);
  assert.equal(r.request.url, `https://x.io/api?limit=1&token_address=${USDC.solana}`);
  assert.deepEqual(r.request.values.map((v) => v.from), ["definition example", "representative"]);

  const post = fromBazaarShape("bazaar", "b", { method: "POST", body: { requestKey: "q-1", tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } }, null, null, null)!;
  const p = buildRequest("https://x.io/roast", { from402: null, x402Endpoint: null, bazaar: post, docs: null }, { today: "2026-11-08" });
  assert.ok(p.ok);
  assert.equal(p.request.method, "POST");
  assert.match((p.request.body as any).requestKey, /^probe-/);
  assert.equal((p.request.body as any).tokenAddress, USDC.base);

  // required in the schema even though the info form does not say so; e.g. in the description
  const chat = fromBazaarShape("bazaar", "b",
    { method: "POST", bodyFields: { model: { type: "string", description: "Model ID (e.g., gpt-4o-mini)" }, messages: { type: "array" } } },
    { properties: { body: { properties: { model: { type: "string" }, messages: { type: "array" } }, required: ["model", "messages"] } } }, null, null)!;
  const c = buildRequest("https://x.io/chat", { from402: null, x402Endpoint: null, bazaar: chat, docs: null }, { today: "2026-11-08" });
  assert.ok(c.ok);
  assert.equal((c.request.body as any).model, "gpt-4o-mini");
  assert.equal(exampleFromDescription("amount", "要换算的金额，如 ?amount=100"), "100");
});

test("request: the 402's own definition wins over the Bazaar; no definition anywhere → 使い方が公開されていない", () => {
  const doc = { x402Version: 2, accepts: [], extensions: { bazaar: { info: { input: { type: "http", method: "GET", queryParams: { city: "Osaka" } } } } } };
  const from402 = fromPaymentRequired(doc);
  const bazaar = fromBazaarShape("bazaar", "b", { method: "GET", queryParams: { city: "Kyoto" } }, null, null, null);
  const r = buildRequest("https://w.io/weather", { from402, x402Endpoint: null, bazaar, docs: null }, { today: "2026-11-08" });
  assert.ok(r.ok);
  assert.equal(r.request.source, "402");
  assert.equal(r.request.query.city, "Osaka");
  const none = buildRequest("https://w.io/x", { from402: null, x402Endpoint: null, bazaar: null, docs: null }, { today: "2026-11-08" });
  assert.equal(none.ok, false);
  // a POST with no body definition is not usage
  const empty = fromBazaarShape("bazaar", "b", { method: "POST", body: {}, bodyType: "json" }, null, null, null);
  assert.equal(buildRequest("https://w.io/x", { from402: null, x402Endpoint: null, bazaar: empty, docs: null }, { today: "2026-11-08" }).ok, false);
});

test("request: OpenAPI operation and an llms.txt curl example", () => {
  const spec = { paths: { "/v1/quote": { get: { parameters: [{ in: "query", name: "symbol", required: true, schema: { type: "string", example: "MSFT" } }] } } } };
  const d = fromOpenApi(spec, "https://o.io/v1/quote", "openapi")!;
  const r = buildRequest("https://o.io/v1/quote", { from402: null, x402Endpoint: null, bazaar: null, docs: d }, { today: "2026-11-08" });
  assert.ok(r.ok);
  assert.equal(r.request.url, "https://o.io/v1/quote?symbol=MSFT");
  const llms = "## Search\ncurl -X POST https://l.io/api/search -d '{\"q\":\"tokyo\"}'\n";
  const t = fromText(llms, "https://l.io/api/search", "llms_txt", "llms")!;
  assert.deepEqual([t.method, t.body_example], ["POST", { q: "tokyo" }]);
  assert.equal(fromText("POST / with JSON-RPC", "https://l.io/", "llms_txt", "llms"), null, "the root path needs a full URL");
});

test("checks: schema, empty/error/placeholder, input reflected, freshness, data kind", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const output = { type: "json", example: { price: 1 }, schema: { type: "object", required: ["symbol", "price"], properties: { price: { type: "number" } } } };
  const good = contentChecks({ body: Buffer.from(JSON.stringify({ symbol: "AAPL", price: 230.1, updated_at: "2026-11-08T11:59:00Z" })), contentType: "application/json", description: "Real-time stock price", output, values: [{ name: "symbol", value: "AAPL" }], now });
  assert.deepEqual(good.map((c) => c.result), ["pass", "pass", "pass", "pass", "pass"]);
  const bad = contentChecks({ body: Buffer.from(JSON.stringify({ price: "n/a", updated_at: "2026-10-01T00:00:00Z" })), contentType: "application/json", description: "Real-time stock price", output, values: [{ name: "symbol", value: "AAPL" }], now });
  assert.deepEqual(bad.map((c) => c.result), ["fail", "pass", "fail", "fail", "pass"]);
  const err = contentChecks({ body: Buffer.from('{"error":"upstream unavailable"}'), contentType: "application/json", description: null, output: null, values: [], now });
  assert.equal(err.find((c) => c.name === "not_empty")!.result, "fail");
  const verbatim = contentChecks({ body: Buffer.from('{"price":1}'), contentType: "application/json", description: null, output, values: [{ name: "symbol", value: "AAPL" }], now });
  assert.match(verbatim.find((c) => c.name === "not_empty")!.detail, /published example/);
  const tts = contentChecks({ body: Buffer.from('{"ok":true}'), contentType: "application/json", description: "Text-to-speech audio (mp3)", output: null, values: [], now });
  assert.equal(tts.find((c) => c.name === "data_kind")!.result, "fail");
});

test("categories: old bare-GET not_delivered rows are re-read by status; every category has a definition", () => {
  const row = (over: Record<string, unknown>) => ({ kind: "paid", host: "h", url: "u", skipped: null, tx: "0xabc", onchain_ok: true, response_bytes: 10, ...over });
  // the 2026-11-07 six: 405 ×3, 403 (Cloudflare), 503 (api_key_required)
  assert.equal(categorize(row({ http_status: 405 }))!.category, "paid_then_rejected");
  assert.equal(categorize(row({ http_status: 403 }))!.category, "paid_then_rejected");
  assert.equal(categorize(row({ http_status: 503 }))!.category, "paid_not_delivered");
  assert.equal(categorize(row({ http_status: 0, error: "paid request: timeout" }))!.category, "paid_not_delivered");
  assert.equal(categorize(row({ http_status: 200 }))!.category, "as_described");
  assert.equal(categorize(row({ http_status: 200, checks: [{ name: "not_empty", result: "fail", detail: "empty JSON" }] }))!.category, "not_as_described");
  assert.equal(categorize(row({ http_status: 200, tx: null, onchain_ok: false }))!.category, "delivered_without_payment");
  assert.equal(categorize(row({ http_status: 200, checks: [{ name: "input_reflected", result: "fail", detail: "none of network=ethereum appears in the output" }] }))!.category, "as_described", "a chain/network is not expected back");
  assert.equal(categorize(row({ http_status: 402, tx: null, onchain_ok: false }))!.category, "not_settled");
  assert.equal(categorize(row({ http_status: 200, request: { values: [] }, checks: [{ name: "not_empty", result: "fail", detail: "the body is the published example, verbatim" }] }))!.category, "as_described");
  assert.equal(categorize(row({ http_status: 200, checks: [{ name: "output_schema", result: "fail", detail: "$.type: missing" }] }))!.category, "as_described");
  assert.equal(fromBazaarShape("bazaar", "b", { method: "GET" }, null, { type: "json" }, { type: "object", properties: { type: { type: "string" } }, required: ["type"] })!.output!.schema, null, "wrapper schema is not the body's");
  assert.equal(categorize(row({ skipped: "not paid: amount 20000 > per-call cap 10000" }))!.category, "over_price");
  assert.equal(categorize(row({ skipped: "HTTP 400 on POST, not 402" }))!.category, "input_mismatch");
  assert.equal(categorize(row({ skipped: "no_usage: 402: no definition" }))!.category, "no_usage");
  assert.equal(categorize(row({ http_status: 404, resolution: "invalid_target", outcome: "invalid_target" })), null);
  for (const k of Object.keys(CATEGORIES)) assert.ok(DEFINITIONS[k as keyof typeof CATEGORIES]);
});

test("buy: the documented request is sent unpaid first; a 400 there means nothing is signed (input mismatch)", async () => {
  const seen: { method: string; url: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, body });
      res.writeHead(req.url === "/search" && !body ? 402 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/search" && !body ? { x402Version: 1, accepts: [] } : { error: "bad request" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  process.env.PROBE_EVM_PRIVATE_KEY = generatePrivateKey();
  const payer = await makePayer();
  const item: CuratedItem = {
    id: "t1", operator: "host:127.0.0.1", operator_name: "local", host: "127.0.0.1", url: `http://127.0.0.1:${port}/search`, name: null, description: null, category: null,
    price_usd: 0.001, network: "eip155:8453", pay_to: null,
    reasons: { listed_in: ["most_called"], operator_tx: 1, operator_buyers: 2, operator_stats_source: "test", endpoint_calls_30d: 1, endpoint_payers_30d: 2, endpoint_stats_source: "test" },
    bazaar: { input: { method: "POST", body: { q: "tokyo" } }, inputSchema: null, output: null, outputSchema: null }, x402_endpoint_id: null,
  };
  const rec = await buyCurated(item, { payer, logDir: "/nonexistent", attemptKind: "paid_attempt", resultKind: "paid" }, "2026-11-08");
  server.close();
  assert.equal(rec.category, "input_mismatch");
  assert.equal(rec.payer_key, null, "nothing signed");
  assert.deepEqual(seen.at(-1), { method: "POST", url: "/search", body: '{"q":"tokyo"}' });
  assert.equal(rec.request!.source, "bazaar");
});
