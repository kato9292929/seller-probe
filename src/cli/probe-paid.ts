import "dotenv/config";
import { balanceReserve, baseUsdc, solanaUsdc } from "../balance.js";
import { spentLast7Days } from "../budget.js";
import { LIMITS } from "../config.js";
import { LOG_DIR, append } from "../log.js";
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
const list = [...t.paid.top.map((x) => ({ ...x, pick: "top" })), ...t.paid.random.map((x) => ({ ...x, pick: "random" }))];
const payer = await makePayer();
console.log(
  `paid probe${dryRun ? " [DRY RUN: sign only, nothing sent]" : ""} (targets ${t.date}, phase ${t.paid.phase}): ${list.length} hosts; ` +
    `payer sol=${payer.address.solana} base=${payer.address.base}; spent(7d)=${spentLast7Days()} / ${LIMITS.perWeek}` +
    (w.missing.length ? `; not configured: ${w.missing.join(", ")}` : ""),
);
// Each chain pays only up to the USDC it holds at the start; hosts past that (in rank order)
// are recorded as deferred, not bought. A balance that cannot be read leaves that chain unchecked.
const start: Record<string, bigint> = {};
for (const [chain, read] of [["solana", solanaUsdc], ["base", baseUsdc]] as const) {
  const addr = payer.address[chain];
  if (!addr) continue;
  try {
    start[chain] = await read(addr);
  } catch (e) {
    console.log(`balance ${chain}: unreadable (${(e as Error).message}); not checked`);
  }
}
console.log(`balance at start: ${Object.entries(start).map(([c, v]) => `${c}=${v}`).join(" ") || "-"}`);
const reserve = balanceReserve(start);
for (const target of list) {
  const r = await probePaid(target, { payer, logDir: LOG_DIR(), attemptKind: "paid_attempt", resultKind: "paid", dryRun, reserve });
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
}
console.log(`spent(7d) now ${spentLast7Days()} / ${LIMITS.perWeek}`);
