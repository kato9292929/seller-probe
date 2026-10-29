import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// README cites these file:line locations for the $0.01 per-call cap. If code moves,
// this fails so the README is updated with it.
const REFS: [string, number, string][] = [
  ["src/config.ts", 37, "perCall: 10_000n"],
  ["src/config.ts", 41, "catalogMaxPriceUsd: 0.01"],
  ["src/pay.ts", 24, 'maxAmountPerPayment: "$0.01"'],
  ["src/pay.ts", 56, "BigInt(a.amount) > LIMITS.perCall"],
  ["src/budget.ts", 30, "amount > LIMITS.perCall"],
  ["src/budget.ts", 31, "spent + amount > LIMITS.perWeek"],
  ["src/probe-paid.ts", 98, "refuseReason(a, ctx.payer.address)"],
  ["src/probe-paid.ts", 109, "assertWithinBudget(amount, spentLast7Days())"],
  ["src/probe-paid.ts", 121, "signFor(ctx.payer, parsed, a)"],
];

const root = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8");

for (const [file, line, snippet] of REFS) {
  test(`README ${file}:${line} → ${snippet}`, () => {
    assert.ok(readme.includes(`\`${file}:${line}\``), `README does not cite ${file}:${line}`);
    const actual = readFileSync(new URL(file, root), "utf8").split("\n")[line - 1] ?? "";
    assert.ok(actual.includes(snippet), `${file}:${line} is now: ${actual.trim()}`);
  });
}
