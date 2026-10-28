import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceReserve } from "../src/balance.js";

test("balance reserve: pays while the chain's start balance lasts, then defers", () => {
  const take = balanceReserve({ solana: 25_000n, base: 5_000n });
  assert.equal(take("solana", 10_000n), null);
  assert.equal(take("solana", 10_000n), null);
  assert.match(take("solana", 10_000n)!, /^balance: solana has 5000 left/);
  assert.equal(take("solana", 5_000n), null, "a cheaper later host still fits");
  assert.equal(take("base", 5_000n), null);
  assert.match(take("base", 1n)!, /^balance: base/);
  assert.equal(take("other", 1n), null, "a chain whose balance was not read is not checked");
});
