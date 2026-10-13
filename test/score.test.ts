import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { latencyScore, scoreHosts, type Weights } from "../src/score.js";

const w: Weights = JSON.parse(readFileSync(new URL("../config/weights.json", import.meta.url), "utf8"));
const now = new Date("2026-10-20T00:00:00Z");
const good = { kind: "free", reachable: true, status_402: true, fields_valid: true, asset_known: true, payto_stable: true, latency_402_ms: 500 };

test("latency: full marks ≤1s, zero ≥10s, linear between", () => {
  assert.equal(latencyScore(800, w), 1);
  assert.equal(latencyScore(10_000, w), 0);
  assert.equal(latencyScore(5500, w), 0.5);
});

test("free-only host: perfect free record scores 100 and is marked free_only", () => {
  const [s] = scoreHosts([{ ts: "2026-10-19T00:00:00Z", host: "a", ...good }] as any, w, now);
  assert.equal(s.score, 100);
  assert.equal(s.coverage, "free_only");
  assert.equal(s.n_paid, 0);
});

test("first observation: payto_stable is not counted", () => {
  const [s] = scoreHosts([{ ts: "2026-10-19T00:00:00Z", host: "a", ...good, payto_stable: null }] as any, w, now);
  assert.equal(s.items.payto_stable.n, 0);
  assert.equal(s.score, 100);
});

test("unreachable host scores 0", () => {
  const [s] = scoreHosts(
    [{ ts: "2026-10-19T00:00:00Z", host: "a", kind: "free", reachable: false, status_402: false, fields_valid: false, asset_known: false, payto_stable: null, latency_402_ms: null }] as any,
    w, now,
  );
  assert.equal(s.score, 0);
});

test("paid not_delivered pulls the score down and sets coverage full", () => {
  const paidBad = { kind: "paid", skipped: null, settle_ok: false, onchain_ok: true, delivered: false, not_delivered: true, latency_paid_ms: 900, cache_header: null };
  const [s] = scoreHosts(
    [{ ts: "2026-10-19T00:00:00Z", host: "a", ...good }, { ts: "2026-10-19T01:00:00Z", host: "a", ...paidBad }] as any,
    w, now,
  );
  assert.equal(s.coverage, "full");
  assert.equal(s.items.not_delivered.value, 0);
  assert.equal(s.items.latency_paid.n, 0, "latency only counts delivered calls");
  // free 65/65 + paid: settle 0, onchain 10, delivered 0, not_delivered 0 → 75 / 115
  assert.equal(s.score, Math.round((1000 * 75) / 115) / 10);
});

test("skipped paid attempts and records outside the window are ignored", () => {
  const [s] = scoreHosts(
    [
      { ts: "2026-10-19T00:00:00Z", host: "a", ...good },
      { ts: "2026-10-19T00:00:00Z", host: "a", kind: "paid", skipped: "budget" },
      { ts: "2026-09-01T00:00:00Z", host: "a", ...good, reachable: false },
    ] as any,
    w, now,
  );
  assert.equal(s.coverage, "free_only");
  assert.equal(s.n_free, 1);
});
