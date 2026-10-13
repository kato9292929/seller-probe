import "dotenv/config";
import { spentLast7Days } from "../budget.js";
import { LIMITS } from "../config.js";
import { LOG_DIR, append } from "../log.js";
import { makePayer } from "../pay.js";
import { probePaid, toRecord } from "../probe-paid.js";
import { latestTargets } from "../targets.js";

const t = latestTargets();
const list = [...t.paid.top.map((x) => ({ ...x, pick: "top" })), ...t.paid.random.map((x) => ({ ...x, pick: "random" }))];
const payer = await makePayer();
console.log(`paid probe (targets ${t.date}, phase ${t.paid.phase}): ${list.length} hosts; payer sol=${payer.address.solana} base=${payer.address.base}; spent(7d)=${spentLast7Days()} / ${LIMITS.perWeek}`);
for (const target of list) {
  const r = await probePaid(target, { payer, logDir: LOG_DIR(), attemptKind: "paid_attempt", resultKind: "paid" });
  append(LOG_DIR(), { ...toRecord(r), pick: target.pick, targets_date: t.date });
  console.log(
    `${target.host}: ${r.skipped ? `skipped (${r.skipped})` : `settle=${r.settle_ok} onchain=${r.onchain_ok} delivered=${r.delivered} not_delivered=${r.not_delivered} tx=${r.tx}`}`,
  );
}
console.log(`spent(7d) now ${spentLast7Days()} / ${LIMITS.perWeek}`);
