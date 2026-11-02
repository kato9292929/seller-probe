import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { memoryKv } from "../src/kv.js";
import { type MonitorState, changes, deliver, listMonitors, prepareRegistration, sign } from "../src/monitor.js";
import { handleReport, normalizeReport, reportSummary } from "../src/reports.js";

const publicDns = (async () => [{ address: "93.184.216.34", family: 4 }]) as any;
const state = (o: Partial<MonitorState> = {}): MonitorState => ({
  at: "", status_402: true, fields_valid: true, amount: "1000", pay_to: "0xA", network: "eip155:8453", receipt_advertised: true, http_status: 402, ...o,
});

test("daily changes: no 402, broken format, price, payTo, receipt keys gone, recovery; first day reports nothing", () => {
  assert.deepEqual(changes(null, state()), []);
  assert.deepEqual(changes(state(), state()), []);
  assert.deepEqual(changes(state(), state({ status_402: false, http_status: 404, fields_valid: false, amount: null })).map((c) => c.kind), ["no_402"]);
  assert.deepEqual(changes(state(), state({ fields_valid: false })).map((c) => c.kind), ["format_broken"]);
  assert.deepEqual(changes(state(), state({ amount: "2000" })), [{ kind: "price_changed", from: "1000", to: "2000" }]);
  assert.deepEqual(changes(state(), state({ pay_to: "0xB" })).map((c) => c.kind), ["payto_changed"]);
  assert.deepEqual(changes(state(), state({ receipt_advertised: false })).map((c) => c.kind), ["receipt_keys_gone"]);
  assert.deepEqual(changes(state({ status_402: false, http_status: 500 }), state()).map((c) => c.kind), ["recovered"]);
});

test("registration: refused (not stored) for a bad URL or webhook; stored only on commit, with a secret, for 30 days", async () => {
  const kv = memoryKv();
  const prep = prepareRegistration(kv, publicDns, () => new Date("2026-11-02T00:00:00Z"));
  const bad = await prep(new Request("https://p/monitor"), { url: "http://s.example/x", webhook: "https://h.example/w" });
  assert.ok("refuse" in bad && bad.refuse.status === 400);
  const ipHook = await prep(new Request("https://p/monitor"), { url: "https://s.example/x", webhook: "https://127.0.0.1/w" });
  assert.ok("refuse" in ipHook && ipHook.refuse.status === 400, "a webhook on an address, not a public name, is refused");
  const ok = await prep(new Request("https://p/monitor"), { url: "https://s.example/x", webhook: "https://h.example/w" });
  assert.ok("commit" in ok);
  assert.equal((await listMonitors(kv)).length, 0, "nothing stored before settlement");
  const res = await ok.commit();
  assert.equal(res.status, 201);
  const reg = await res.json();
  assert.match(reg.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(reg.expires_at, "2026-12-02T00:00:00.000Z");
  const ms = await listMonitors(kv, new Date("2026-11-10T00:00:00Z"));
  assert.deepEqual(ms.map((m) => m.host), ["s.example"]);
  assert.equal((await listMonitors(kv, new Date("2026-12-03T00:00:00Z"))).length, 0, "expired registrations drop out");
});

test("notifications are signed with the registration's secret", async () => {
  let got: { body: string; sig: string } | null = null;
  const srv = createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d)).on("end", () => {
      got = { body: b, sig: String(req.headers["x-probe-signature"]) };
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as any).port;
  const m = { id: "m1", url: "https://s.example/x", host: "s.example", webhook: `https://hook.example/w`, secret: "s3cret", created_at: "", expires_at: "" };
  // The webhook is validated as public, then posted; here the POST is redirected to the local server.
  const viaLocal = ((_u: string, init: RequestInit) => fetch(`http://127.0.0.1:${port}/w`, init)) as typeof fetch;
  try {
    const r = await deliver(m, { type: "free_change", changes: [{ kind: "no_402", from: 402, to: 404 }] }, viaLocal, publicDns);
    assert.equal(r.ok, true);
    assert.equal(got!.sig, `sha256=${createHmac("sha256", "s3cret").update(got!.body).digest("hex")}`);
    assert.equal(got!.sig, sign("s3cret", got!.body));
    assert.equal(JSON.parse(got!.body).monitor_id, "m1");
  } finally {
    srv.close();
  }
  const refused = await deliver({ ...m, webhook: "https://10.0.0.1/w" }, {}, viaLocal, publicDns);
  assert.equal(refused.ok, false);
});

test("reports: anonymous fields only (payer, tx, body dropped), counted apart from the Probe's measurements", async () => {
  const kv = memoryKv();
  const post = (b: unknown) => handleReport(new Request("https://p/reports", { method: "POST", body: JSON.stringify(b) }), kv);
  const rep = {
    v: 1, url: "https://www.s.example/x?q=1", network: "eip155:8453", amount: "1000", outcome: "delivered", http_status: 200, latency_ms: 812,
    settled_header: true, onchain_found: true, receipt_ok: null, refetched: false, sdk: "@x402jp/safe-buy@0.1.0", ts: "2026-11-02T01:00:00Z",
    payer: "0xBUYER", tx: "0xTX", body: "secret data",
  };
  assert.equal((await post(rep)).status, 202);
  assert.equal((await post({ ...rep, outcome: "nonsense" })).status, 400);
  assert.equal((await post({ ...rep, url: "http://s.example/x" })).status, 400);
  const n = normalizeReport(rep) as any;
  assert.equal(n.host, "s.example");
  assert.equal(n.url, "https://www.s.example/x", "query dropped");
  for (const k of ["payer", "tx", "body"]) assert.ok(!(k in n), k);
  assert.deepEqual(await reportSummary(kv), { received: 1, hosts: 1, by_host: { "s.example": 1 } });
  assert.equal((await handleReport(new Request("https://p/reports", { method: "POST", body: "{}" }), null)).status, 503, "no KV: refused, not lost silently");
});
