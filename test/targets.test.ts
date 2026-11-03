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
  ep("4b", "https://c2.example/url/:domain", 0.001),
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
  for (const h of ["c.example", "c2.example", "d.example", "e.example", "f.example"]) assert.ok(!reps.find((t) => t.host === h), h);
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

test('top_n "all": the whole ranking is a candidate, no random draw', () => {
  const pop = { metric: "m", fetched_at: "", status: "ok" as const, rows: Array.from({ length: 190 }, (_, i) => ({ host: `r${i}.example`, tx_count: 1000 - i })) };
  const many = { ...catalog, endpoints: pop.rows.map((r, i) => ep(`m${i}`, `https://${r.host}/x`, 0.005)) };
  const t = buildTargets("2026-10-28", many, pop, { paid: { phase: "all_buyable", top_n: "all", random_n: 0 } });
  assert.equal(t.paid.top_n, "all");
  assert.equal(t.paid.top.length, 190);
  assert.equal(t.paid.top_candidates!.length, 190);
  assert.equal(t.paid.random.length, 0);
});

test("catalog rotation: hosts outside the ranking that offered a payable 402, in 4 stable groups", async () => {
  const { rotationGroup, weekGroup } = await import("../src/targets.js");
  const pop = { metric: "m", fetched_at: "", status: "ok" as const, rows: [{ host: "r0.example", tx_count: 9 }] };
  const many = { ...catalog, endpoints: Array.from({ length: 40 }, (_, i) => ep(`c${i}`, `https://c${i}.example/x`, 0.001 * ((i % 9) + 1))) };
  const payable = new Set(Array.from({ length: 40 }, (_, i) => `c${i}.example`).filter((_, i) => i % 5 !== 0));
  const cfg = { paid: { phase: "catalog_rotation", top_n: "all" as const, random_n: 0, catalog: { rotation_groups: 4 } } };
  const all = buildTargets("2026-11-02", many, pop, cfg, { payable, group: "all" });
  assert.equal(all.paid.catalog!.length, 32, "only hosts that offered a payable 402");
  assert.ok(all.paid.catalog!.every((t, i, a) => i === 0 || a[i - 1].price_usd <= t.price_usd), "cheapest first");
  const g = weekGroup("2026-11-02", 4);
  const week = buildTargets("2026-11-02", many, pop, cfg, { payable });
  assert.ok(week.paid.catalog!.every((t) => rotationGroup(t.host, 4) === g));
  const union = new Set([0, 1, 2, 3].flatMap((k) => buildTargets("2026-11-02", many, pop, cfg, { payable, group: k }).paid.catalog!.map((t) => t.host)));
  assert.equal(union.size, 32, "the 4 groups cover every host once");
  assert.notEqual(weekGroup("2026-11-02", 4), weekGroup("2026-11-09", 4));
  assert.equal(weekGroup("2026-11-02", 4), weekGroup("2026-11-30", 4));
});
