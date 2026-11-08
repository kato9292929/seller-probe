import "dotenv/config";
import { balanceReserve, readBalance } from "../balance.js";
import { SpendTracker, spentLast7Days } from "../budget.js";
import { LIMITS } from "../config.js";
import { LOG_DIR, append, readRecords } from "../log.js";
import { makePayer } from "../pay.js";
import { probePaid, toRecord } from "../probe-paid.js";
import { latestTargets } from "../targets.js";
import { loadLocalKeys, walletStatus } from "../wallet-env.js";

const dryRun = process.argv.includes("--dry-run") || process.env.PROBE_DRY_RUN === "1";
loadLocalKeys();
const w = walletStatus();
if (!w.usable) {
  // Not an error: the wallet simply is not set up yet. Record it and stop.
  append(LOG_DIR(), { kind: "run_skipped", host: "-", run: "paid", reason: "secrets not configured (未設定)", missing: w.missing, dry_run: dryRun || undefined });
  console.log(`paid probe: skipped — secrets not configured (未設定): ${w.missing.join(", ")}`);
  process.exit(0);
}
const t = latestTargets();
// Ranking first (in rank order), then the catalog hosts of this rotation group (cheapest first).
// A host already bought in the last 20 hours (e.g. by the scheduled run the same day) is not bought again.
const recent = new Set(
  readRecords(LOG_DIR(), 2)
    .filter((r) => r.kind === "paid" && !r.skipped && !r.dry_run && Date.now() - Date.parse(r.ts) < 20 * 3_600_000)
    .map((r) => r.host),
);
const all = [
  ...t.paid.top.map((x) => ({ ...x, pick: "top" })),
  ...t.paid.random.map((x) => ({ ...x, pick: "random" })),
  ...(t.paid.catalog ?? []).map((x) => ({ ...x, pick: "catalog" })),
];
// PROBE_RETRY_DEFERRED=1 (after a top-up): buy only the hosts whose latest purchase in the last
// 8 days was deferred for want of balance, from the URL and price that row recorded.
const retry = process.env.PROBE_RETRY_DEFERRED === "1";
const deferred = (() => {
  const last = new Map<string, Record<string, unknown>>();
  for (const r of readRecords(LOG_DIR(), 8)) if (r.kind === "paid" && !r.dry_run) last.set(r.host, r);
  return [...last.values()]
    .filter((r) => typeof r.skipped === "string" && r.skipped.startsWith("deferred"))
    // URLs recorded before template paths were excluded (seller-probe#18) are not bought again.
    .filter((r) => !/%7B|%7D|[{}]/i.test(String(r.url)) && !/\/:[A-Za-z_]/.test(String(r.url)))
    .map((r) => ({ host: String(r.host), url: String(r.url), endpoint_id: "deferred", price_usd: Number(r.amount ?? 0) / 1e6, networks: [], pick: "deferred" }));
})();
const list = retry ? deferred : dryRun ? all : all.filter((x) => !recent.has(x.host));
if (retry) console.log(`retrying ${deferred.length} host(s) deferred for want of balance`);
if (list.length < all.length) console.log(`${all.length - list.length} hosts already bought in the last 20 hours: not bought again`);
const payer = await makePayer();
console.log(
  `paid probe${dryRun ? " [DRY RUN: sign only, nothing sent]" : ""} (targets ${t.date}, phase ${t.paid.phase}): ${list.length} hosts; ` +
    `payer sol=${payer.address.solana} base=${payer.address.base}; spent(7d)=${spentLast7Days()} / ${LIMITS.perWeek}` +
    (w.missing.length ? `; not configured: ${w.missing.join(", ")}` : ""),
);
// Each chain pays only up to the USDC it holds at the start; hosts past that (in rank order)
// are recorded as deferred, not bought. A balance that cannot be read leaves that chain unchecked.
// The configured RPC first, then the public one; a chain whose balance neither returns is not
// paid from in this run (its hosts are deferred).
const start: Record<string, bigint> = {};
const unreadable: string[] = [];
for (const chain of ["solana", "base"] as const) {
  const addr = payer.address[chain];
  if (!addr) continue;
  const b = await readBalance(chain, addr);
  if (b.errors.length) console.log(`balance ${chain}: ${b.errors.join(" | ")}`);
  if (b.balance === null) {
    unreadable.push(chain);
    console.log(`balance ${chain}: unreadable on every RPC; no ${chain} purchase is sent this run`);
  } else start[chain] = b.balance;
}
console.log(`balance at start: ${Object.entries(start).map(([c, v]) => `${c}=${v}`).join(" ") || "-"}`);
const reserve = balanceReserve(start, unreadable);
// Purchases run PROBE_PAID_CONCURRENCY at a time (default 6). The caps, signing and the attempt
// record still go one at a time (SpendTracker), in list order.
const tracker = new SpendTracker(spentLast7Days());
const CONCURRENCY = Math.max(1, Number(process.env.PROBE_PAID_CONCURRENCY ?? 6));
let next = 0;
const one = async (target: (typeof list)[number]) => {
  const r = await probePaid(target, { payer, logDir: LOG_DIR(), attemptKind: "paid_attempt", resultKind: "paid", dryRun, reserve, tracker });
  append(LOG_DIR(), { ...toRecord(r), pick: target.pick, targets_date: t.date });
  console.log(
    `${target.host}: ` +
      (dryRun
        ? `${r.network ?? "-"} amount=${r.amount ?? "-"} cap=${r.cap_check ? (r.cap_check.pass ? "pass" : `reject (${r.cap_check.reason})`) : "-"} ` +
          `signed=${r.payer_key ? JSON.stringify(r.payer_key) : "no"}${r.skipped && !r.skipped.startsWith("dry_run") ? ` (${r.skipped})` : ""}`
        : r.skipped
          ? `skipped (${r.skipped})`
          : `settle=${r.settle_ok} onchain=${r.onchain_ok} delivered=${r.delivered} not_delivered=${r.not_delivered} tx=${r.tx}`),
  );
};
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (next < list.length) await one(list[next++]);
  }),
);
console.log(`spent(7d) now ${spentLast7Days()} / ${LIMITS.perWeek}`);
