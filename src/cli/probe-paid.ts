import "dotenv/config";
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
for (const target of list) {
  const r = await probePaid(target, { payer, logDir: LOG_DIR(), attemptKind: "paid_attempt", resultKind: "paid", dryRun });
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
