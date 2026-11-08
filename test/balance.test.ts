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

test("a chain whose balance is unreadable on every RPC is not paid from; the public RPC is tried second", async () => {
  const { readBalance } = await import("../src/balance.js");
  const take = balanceReserve({ base: 100_000n }, ["solana"]);
  assert.match(take("solana", 1n)!, /unreadable/);
  assert.equal(take("base", 1000n), null);
  const seen: (string | undefined)[] = [];
  const ok = await readBalance("solana", "owner", async (_o, url) => { seen.push(url); if (!url) throw new Error("indexed requests require a token"); return 5n; });
  assert.deepEqual([ok.balance, seen.length, ok.errors.length], [5n, 2, 1]);
  assert.equal(seen[1], "https://api.mainnet-beta.solana.com");
  const none = await readBalance("base", "owner", async () => { throw new Error("down"); });
  assert.equal(none.balance, null);
  assert.equal(none.errors.length, 2);
});
