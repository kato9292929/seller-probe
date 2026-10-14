import assert from "node:assert/strict";
import { test } from "node:test";
import { representatives } from "../src/catalog.js";
import { buildTargets } from "../src/targets.js";

const ep = (id: string, url: string, amount: number, networks = ["Base"], currency = "USDC") =>
  ({ id, url, price: { amount, currency, unit: "per-call" }, networks, protocols: ["x402"] }) as any;

const endpoints = [
  ep("1", "https://a.example/expensive", 0.05),
  ep("2", "https://a.example/cheap", 0.001),
  ep("3", "https://www.b.example/x", 0.02, ["Solana"]),
  ep("4", "https://c.example/{id}", 0.001),
  ep("5", "https://d.example/x", 0.001, ["Polygon"]),
  ep("6", "https://e.example/x", 0.001, ["Base"], "EURC"),
  ep("7", "http://f.example/x", 0.001),
  ...Array.from({ length: 30 }, (_, i) => ep(`r${i}`, `https://r${i}.example/x`, 0.005)),
];
const catalog = { source: { repo: "r", commit: "c", file: "f", generated_at: null }, endpoints };

test("one cheapest endpoint per host; only https, USDC, Solana/Base, concrete URLs", () => {
  const reps = representatives(endpoints);
  const a = reps.find((t) => t.host === "a.example")!;
  assert.equal(a.url, "https://a.example/cheap");
  assert.ok(reps.find((t) => t.host === "b.example"), "www. is stripped");
  for (const h of ["c.example", "d.example", "e.example", "f.example"]) assert.ok(!reps.find((t) => t.host === h), h);
});

test("paid: popular hosts within $0.01, then a reproducible random draw", () => {
  const pop = { metric: "m", fetched_at: "", status: "ok" as const, rows: [{ host: "b.example", tx_count: 99 }, { host: "a.example", tx_count: 50 }, { host: "zzz", tx_count: 1 }] };
  const cfg = { paid: { phase: "full", top_n: 50, random_n: 20 } };
  const t1 = buildTargets("2026-10-13", catalog, pop, cfg);
  assert.deepEqual(t1.paid.top.map((t) => t.host), ["a.example"]);
  assert.deepEqual(t1.paid.skipped_popular.map((s) => s.host), ["b.example", "zzz"]);
  assert.equal(t1.paid.random.length, 20);
  assert.ok(!t1.paid.random.some((t) => t.host === "a.example"), "random excludes the top set");
  const t2 = buildTargets("2026-10-13", catalog, pop, cfg);
  assert.deepEqual(t2.paid.random.map((t) => t.host), t1.paid.random.map((t) => t.host));
  const t3 = buildTargets("2026-10-14", catalog, pop, cfg);
  assert.notDeepEqual(t3.paid.random.map((t) => t.host), t1.paid.random.map((t) => t.host));
});

test("initial phase: top 10, no random", () => {
  const pop = { metric: "m", fetched_at: "", status: "ok" as const, rows: Array.from({ length: 30 }, (_, i) => ({ host: `r${i}.example`, tx_count: 100 - i })) };
  const t = buildTargets("2026-10-13", catalog, pop, { paid: { phase: "initial", top_n: 10, random_n: 0 } });
  assert.equal(t.paid.top.length, 10);
  assert.equal(t.paid.top[0].host, "r0.example");
  assert.equal(t.paid.random.length, 0);
});
