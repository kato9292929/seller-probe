// Monitoring notifications (src/monitor.ts). Daily (free-daily): measure each registered URL with a
// bare GET and post changes to its webhook. Weekly (paid-weekly, --paid): post the outcome of the
// Probe's purchase from a registered host. Nothing is written to log/ (registrations are not measurements).
import "dotenv/config";
import { upstash } from "../kv.js";
import { LOG_DIR, readRecords } from "../log.js";
import { type MonitorState, changes, deliver, listMonitors } from "../monitor.js";
import { outcomeOf, rejectionText } from "../outcome.js";
import { probeFree } from "../probe-free.js";

const kv = upstash();
if (!kv) {
  console.log("notify: skipped — no KV configured (UPSTASH_REDIS_REST_URL / _TOKEN)");
  process.exit(0);
}
const monitors = await listMonitors(kv);
console.log(`notify: ${monitors.length} active monitor(s)`);

if (process.argv.includes("--paid")) {
  const rows = readRecords(LOG_DIR(), 1).filter((r) => r.kind === "paid" && !r.skipped && !r.dry_run);
  for (const m of monitors) {
    const [last] = (await kv.pipeline([["GET", `monitor:paid_sent:${m.id}`]])) as [string | null];
    for (const r of rows.filter((x) => x.host === m.host && (!last || x.ts > last))) {
      const res = await deliver(m, {
        type: "paid_result", ts: r.ts, outcome: outcomeOf(r), http_status: r.http_status ?? null, reason: rejectionText(r) ?? (r.error as string | null) ?? null,
        tx: r.tx ?? null, network: r.network ?? null, amount: r.amount ?? null, response_sha256: r.response_sha256 ?? null, price_check: r.price_check ?? null,
      });
      console.log(`${m.host} paid_result ${outcomeOf(r)} → ${res.ok ? "sent" : `failed (${res.status ?? res.error})`}`);
      await kv.pipeline([["SET", `monitor:paid_sent:${m.id}`, r.ts], ["EXPIRE", `monitor:paid_sent:${m.id}`, 40 * 86_400]]);
    }
  }
} else {
  for (const m of monitors) {
    const r = await probeFree({ host: m.host, url: m.url, endpoint_id: "monitor", price_usd: 0, networks: [] }, () => null);
    const cur: MonitorState = {
      at: new Date().toISOString(), status_402: r.status_402, fields_valid: r.fields_valid, amount: r.amount, pay_to: r.pay_to, network: r.network,
      receipt_advertised: r.receipt_advertised ?? null, http_status: r.http_status,
    };
    const [prevRaw] = (await kv.pipeline([["GET", `monitor:state:${m.id}`]])) as [string | null];
    const diff = changes(prevRaw ? (JSON.parse(prevRaw) as MonitorState) : null, cur);
    if (diff.length) {
      const res = await deliver(m, { type: "free_change", at: cur.at, changes: diff, state: cur });
      console.log(`${m.host} ${diff.map((d) => d.kind).join(",")} → ${res.ok ? "sent" : `failed (${res.status ?? res.error})`}`);
    }
    await kv.pipeline([["SET", `monitor:state:${m.id}`, JSON.stringify(cur)], ["EXPIRE", `monitor:state:${m.id}`, 40 * 86_400]]);
  }
}
