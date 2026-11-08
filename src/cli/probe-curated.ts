// Weekly purchase of the curated endpoints (targets/curated.json), each called the way it is
// documented. Same caps, balance rule, attempt-before-send log and chain checks as every paid probe.
//   npm run probe:curated               buy
//   npm run probe:curated -- --dry-run  everything up to signing; nothing is sent
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { balanceReserve, readBalance } from "../balance.js";
import { SpendTracker, spentLast7Days } from "../budget.js";
import { LIMITS, ROOT } from "../config.js";
import { buyCurated } from "../curated/buy.js";
import type { CuratedFile } from "../curated/curate.js";
import { LOG_DIR, append, readRecords } from "../log.js";
import { makePayer } from "../pay.js";
import { loadLocalKeys, walletStatus } from "../wallet-env.js";

const dryRun = process.argv.includes("--dry-run") || process.env.PROBE_DRY_RUN === "1";
loadLocalKeys();
const w = walletStatus();
if (!w.usable) {
  append(LOG_DIR(), { kind: "run_skipped", host: "-", run: "curated", reason: "secrets not configured (未設定)", missing: w.missing, dry_run: dryRun || undefined });
  console.log(`curated purchase: skipped — secrets not configured (未設定): ${w.missing.join(", ")}`);
  process.exit(0);
}
const file: CuratedFile = JSON.parse(readFileSync(resolve(ROOT, "targets/curated.json"), "utf8"));
// An endpoint already bought in the last 20 hours (e.g. a manual run the same day) is not bought again.
const recent = new Set(
  readRecords(LOG_DIR(), 2)
    .filter((r) => r.kind === "paid" && r.pick === "curated" && !r.skipped && !r.dry_run && Date.now() - Date.parse(r.ts) < 20 * 3_600_000)
    .map((r) => String(r.curated_id)),
);
const only = process.env.CURATED_ONLY?.split(",").filter(Boolean);
const list = file.items.filter((i) => (dryRun || !recent.has(i.id)) && (!only || only.includes(i.id) || only.includes(i.host)));
const payer = await makePayer();
console.log(
  `curated purchase${dryRun ? " [DRY RUN]" : ""} (curated ${file.generated_at.slice(0, 10)}): ${list.length} endpoints; ` +
    `payer sol=${payer.address.solana} base=${payer.address.base}; spent(7d)=${spentLast7Days()} / ${LIMITS.perWeek}`,
);
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
const tracker = new SpendTracker(spentLast7Days());
const today = new Date().toISOString().slice(0, 10);
// One request per endpoint at a time per host: purchases on the same host are never parallel.
const CONCURRENCY = Math.max(1, Number(process.env.PROBE_PAID_CONCURRENCY ?? 4));
const byHost = new Map<string, typeof list>();
for (const i of list) (byHost.get(i.host) ?? byHost.set(i.host, []).get(i.host)!).push(i);
const queues = [...byHost.values()];
let next = 0;
const counts: Record<string, number> = {};
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queues.length) }, async () => {
    while (next < queues.length) {
      for (const item of queues[next++]) {
        const rec = await buyCurated(item, { payer, logDir: LOG_DIR(), attemptKind: "paid_attempt", resultKind: "paid", dryRun, reserve, tracker }, today);
        append(LOG_DIR(), { ...rec, curated_date: file.generated_at.slice(0, 10) } as any);
        counts[rec.category ?? "-"] = (counts[rec.category ?? "-"] ?? 0) + 1;
        console.log(`${item.host} ${rec.request?.method ?? "-"} ${item.url.slice(0, 80)} → ${rec.category ?? (rec.skipped ?? "-")}${rec.tx ? ` tx=${rec.tx}` : ""}${rec.category_reason ? ` (${rec.category_reason.slice(0, 120)})` : ""}`);
      }
    }
  }),
);
console.log(`categories: ${JSON.stringify(counts)}`);
console.log(`spent(7d) now ${spentLast7Days()} / ${LIMITS.perWeek}`);
