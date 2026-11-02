import assert from "node:assert/strict";
import { test } from "node:test";
import { BudgetError, assertWithinBudget, spentFrom } from "../src/budget.js";

test("per-call cap is $0.01", () => {
  assert.doesNotThrow(() => assertWithinBudget(10_000n, 0n));
  assert.throws(() => assertWithinBudget(10_001n, 0n), BudgetError);
  assert.throws(() => assertWithinBudget(0n, 0n), BudgetError);
});

test("weekly cap is $25", () => {
  assert.doesNotThrow(() => assertWithinBudget(10_000n, 24_990_000n));
  assert.throws(() => assertWithinBudget(10_000n, 24_990_001n), BudgetError);
});

test("concurrent purchases go through the cap one at a time and cannot pass it together", async () => {
  const { SpendTracker } = await import("../src/budget.js");
  const tr = new SpendTracker(24_970_000n);
  const results = await Promise.all(Array.from({ length: 6 }, () => tr.exclusive(async () => {
    try {
      assertWithinBudget(10_000n, tr.spent);
    } catch {
      return "refused";
    }
    await new Promise((r) => setTimeout(r, 5));
    tr.spent += 10_000n;
    return "paid";
  })));
  assert.deepEqual(results.filter((r) => r === "paid").length, 3);
  assert.equal(tr.spent, 25_000_000n);
});

test("spend counts every attempt in the last 7 days, paid and self-check", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const recs = [
    { ts: "2026-10-19T00:00:00Z", kind: "paid_attempt", host: "a", amount: "10000" },
    { ts: "2026-10-18T00:00:00Z", kind: "self_check_attempt", host: "jin", amount: "10000" },
    { ts: "2026-10-12T00:00:00Z", kind: "paid_attempt", host: "old", amount: "10000" }, // > 7 days
    { ts: "2026-10-19T00:00:00Z", kind: "paid", host: "a", amount: "10000" }, // result, not an attempt
  ] as any[];
  assert.equal(spentFrom(recs, now), 20_000n);
});
