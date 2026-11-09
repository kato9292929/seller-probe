import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { curatedReport } from "../src/curated/publish.js";
import { badgeOf, initials, matchOfficial, operatorCards, registrable } from "../src/curated/operators.js";

test("badge: the worst result among what was bought; only unbought → 未購入", () => {
  assert.equal(badgeOf(["as_described", "as_described"]), "as_described");
  assert.equal(badgeOf(["as_described", "over_price"]), "as_described", "an unbought endpoint does not count");
  assert.equal(badgeOf(["as_described", "not_as_described"]), "not_as_described");
  for (const c of ["paid_not_delivered", "paid_then_rejected", "not_settled"]) assert.equal(badgeOf(["not_as_described", c]), "not_delivered");
  assert.equal(badgeOf(["over_price", "no_usage", "input_mismatch"]), "not_bought");
  assert.equal(badgeOf([null]), "not_bought");
});

test("cards: one per operator, ordered by x402 Endpoint tx; counts and lowest price; initials like 'OP'", () => {
  const it = (id: string, op: string, tx: number, cat: string, price: number) => ({
    id, operator_key: op, host: `${op}.io`, url: `https://${op}.io/${id}`, price_usd: price, category: "data",
    reasons: { operator_tx: tx, operator_buyers: 5 }, last: { category: cat },
  });
  const cards = operatorCards(
    [it("a1", "small", 10, "as_described", 0.002), it("b1", "big", 900, "as_described", 0.01), it("b2", "big", 900, "over_price", 0.05), it("b3", "big", 900, "as_described", 0.001)],
    [{ operator: "big", slug: "big", name: "Big API", party: "3P", via: ["gw.example"], domain: "big.io", category: "media", official_slug: "big-via", logo: "/logos/big.png", logo_source: "official" }],
  );
  assert.deepEqual(cards.map((c) => c.operator), ["big", "small"]);
  assert.deepEqual([cards[0].endpoints, cards[0].bought, cards[0].as_described, cards[0].price_min, cards[0].badge_label], [3, 2, 2, 0.001, "説明どおり"]);
  assert.deepEqual([cards[0].party, cards[0].via, cards[0].category], ["3P", "gw.example", "Media"]);
  assert.equal(cards[1].logo_source, "initials");
  // operators bought from come first; an unbought one says why; delivered-without-payment is counted apart
  const more = operatorCards(
    [it("m1", "messari", 5000, "over_price", 0.75), it("a1", "agent", 10, "as_described", 0.002), it("a2", "agent", 10, "delivered_without_payment", 0.002)],
    [],
  );
  assert.deepEqual(more.map((c) => c.operator), ["agent", "messari"]);
  assert.equal(more[1].not_bought_reason, "$0.01 超（$0.75）");
  assert.deepEqual([more[0].bought, more[0].as_described, more[0].delivered_without_payment, more[0].badge], [2, 1, 1, "as_described"]);
  assert.equal(initials("OpenAI"), "OP");
  assert.equal(registrable("agent-kiosk.vercel.app"), "agent-kiosk.vercel.app", "a hosting subdomain is its own domain");
  assert.equal(registrable("api.nansen.ai"), "nansen.ai");
  assert.equal(matchOfficial(["www.api-xpay.com"], [{ slug: "x", name: "X Pay", party: "1P", domain: "api-xpay.com", category: null, hosts: ["api-xpay.com"], via: [], logo: null }])?.name, "X Pay");
});

test("the header's numbers come from the data: operators, endpoints and the purchase date", () => {
  const curated = JSON.parse(readFileSync(new URL("../targets/curated.json", import.meta.url), "utf8"));
  const ops = existsSync(new URL("../targets/operators.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("../targets/operators.json", import.meta.url), "utf8")).operators : [];
  const rows = [{ kind: "paid", pick: "curated", curated_id: curated.items[0].id, host: curated.items[0].host, ts: "2026-11-08T13:24:00Z", skipped: "not paid: amount 20000 > per-call cap 10000" }];
  const r = curatedReport({ records: rows as any, selfChecks: [], curated, now: new Date("2026-11-09T00:00:00Z"), operators: ops });
  assert.equal(r.summary.endpoints, curated.items.length);
  assert.equal(r.summary.operators, new Set(curated.items.map((i: any) => i.operator)).size);
  assert.equal(r.summary.purchased_on, "2026-11-08");
  assert.equal(r.cards.length, r.summary.operators);
  // every logo the cards name is a committed file (no logo is loaded from another site)
  for (const c of r.cards) if (c.logo) assert.ok(existsSync(new URL(`../web/public${c.logo}`, import.meta.url)), c.logo);
});
