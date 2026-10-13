import "dotenv/config";
import { LOG_DIR, append, readRecords } from "../log.js";
import { probeFree } from "../probe-free.js";
import { latestTargets } from "../targets.js";

const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 8);
const t = latestTargets();
const limit = process.env.PROBE_LIMIT ? Number(process.env.PROBE_LIMIT) : t.free.length;
const targets = t.free.slice(0, limit);

// payTo from each host's previous free measurement (per chain), for payto_stable.
const last = new Map<string, string>();
for (const r of readRecords(LOG_DIR(), 90).filter((r) => r.kind === "free" && r.chain && r.pay_to).sort((a, b) => a.ts.localeCompare(b.ts)))
  last.set(`${r.host}|${r.chain}`, String(r.pay_to));
const prev = (host: string, chain: string) => last.get(`${host}|${chain}`) ?? null;

let i = 0;
const tally = { n: 0, reachable: 0, status_402: 0, fields_valid: 0 };
async function worker() {
  while (i < targets.length) {
    const target = targets[i++];
    const r = await probeFree(target, prev);
    append(LOG_DIR(), { ...r, targets_date: t.date });
    tally.n++;
    if (r.reachable) tally.reachable++;
    if (r.status_402) tally.status_402++;
    if (r.fields_valid) tally.fields_valid++;
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
console.log(`free probe (targets ${t.date}): ${JSON.stringify(tally)}`);
