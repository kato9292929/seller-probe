import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeller, handleCheck, isPrivateAddress, rateLimit, validateTarget } from "../src/check.js";

const publicDns = (async () => [{ address: "93.184.216.34", family: 4 }]) as any;
const v2 = (accept: Record<string, unknown>, extensions?: Record<string, unknown>) => {
  const doc = { x402Version: 2, resource: { url: "https://s.example/x" }, accepts: [accept], ...(extensions ? { extensions } : {}) };
  return { status: 402, header: (n: string) => (n.toLowerCase() === "payment-required" ? Buffer.from(JSON.stringify(doc)).toString("base64") : null), body: "{}" };
};
const baseAccept = (extra: Record<string, unknown> = { name: "USD Coin", version: "2" }) => ({
  scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60, extra,
});
const noReceipt = async () => ({ advertised: false, wellKnown: null, error: "HTTP 404" });
const status = (r: { items: { id: string; status: string }[] }) => Object.fromEntries(r.items.map((i) => [i.id, i.status]));

test("a well-formed Base seller passes; missing EIP-712 domain fails with a fix", async () => {
  const ok = await checkSeller(new URL("https://s.example/x"), { get: async () => v2(baseAccept()), wellKnown: noReceipt, probeRecord: async () => null });
  assert.deepEqual(status(ok), { status_402: "pass", fields: "pass", usdc: "pass", eip712: "pass", input: "warn", payment_identifier: "info", receipt: "warn", probe: "info" });
  const bad = await checkSeller(new URL("https://s.example/x"), { get: async () => v2(baseAccept({})), wellKnown: noReceipt, probeRecord: async () => null });
  const e = bad.items.find((i) => i.id === "eip712")!;
  assert.equal(e.status, "fail");
  assert.match(e.fix!, /USD Coin/);
  assert.ok(bad.items.every((i) => i.status === "pass" || i.status === "na" || i.fix !== undefined));
});

test("no 402: the payment items are not applicable; the Probe record is shown, settlement is not tested", async () => {
  const r = await checkSeller(new URL("https://s.example/x"), {
    get: async () => ({ status: 200, header: () => null, body: "ok" }), wellKnown: noReceipt,
    probeRecord: async () => ({ last_paid: { date: "2026-10-28", outcome: "request_rejected", price_usd: 0.001 }, last_rejection: { ts: "", http_status: 400, error: "address required" } }),
  });
  const s = status(r);
  assert.equal(s.status_402, "fail");
  assert.equal(s.fields, "na");
  assert.equal(s.probe, "warn");
  assert.match(r.items.find((i) => i.id === "probe")!.detail, /address required/);
});

test("non-official asset, required input and required payment-identifier are reported", async () => {
  const acc = { ...baseAccept(), asset: "0x1111111111111111111111111111111111111111" };
  const r = await checkSeller(new URL("https://s.example/x"), {
    get: async () => v2(acc, { bazaar: { info: { input: { method: "POST" } } }, "payment-identifier": { info: { required: true } } }),
    wellKnown: noReceipt, probeRecord: async () => null,
  });
  const s = status(r);
  assert.equal(s.input, "info");
  assert.equal(s.payment_identifier, "info");
  assert.match(r.items.find((i) => i.id === "payment_identifier")!.detail, /必須/);
});

test("SSRF guard: https, public names and public addresses only", async () => {
  for (const u of ["http://s.example/x", "https://127.0.0.1/x", "https://localhost/x", "https://s.example:8443/x", "https://u:p@s.example/x", "https://intranet/x"])
    assert.ok("error" in (await validateTarget(u, publicDns)), u);
  assert.ok("error" in (await validateTarget("https://s.example/x", (async () => [{ address: "10.0.0.5", family: 4 }]) as any)));
  assert.ok("url" in (await validateTarget("https://s.example/x", publicDns)));
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  assert.equal(isPrivateAddress("93.184.216.34"), false);
});

test("one check per host per minute", async () => {
  const seen = new Map<string, number>();
  assert.equal(rateLimit(seen, "a.example", 0), 0);
  assert.ok(rateLimit(seen, "a.example", 30_000) > 0);
  assert.equal(rateLimit(seen, "b.example", 30_000), 0);
  assert.equal(rateLimit(seen, "a.example", 60_000), 0);
  const deps = { resolve: publicDns, get: async () => v2(baseAccept()), wellKnown: noReceipt, probeRecord: async () => null };
  assert.equal((await handleCheck(new Request("https://probe.test/check?url=https://rl.example/x"), deps)).status, 200);
  assert.equal((await handleCheck(new Request("https://probe.test/check?url=https://rl.example/y"), deps)).status, 429);
  assert.equal((await handleCheck(new Request("https://probe.test/check"), deps)).status, 400);
});

test("api/check.js is the current bundle of src/api-check.ts", () => {
  const out = join(mkdtempSync(join(tmpdir(), "api-")), "check.js");
  const cmd = JSON.parse(readFileSync("package.json", "utf8")).scripts["build:api"].replace("--outfile=api/check.js", `--outfile=${out}`);
  execFileSync("sh", ["-c", `npx ${cmd} --log-level=error`]);
  assert.equal(readFileSync(out, "utf8"), readFileSync("api/check.js", "utf8"), "run npm run build:api and commit api/check.js");
});
