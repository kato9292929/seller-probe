import "dotenv/config";
import { SELF_CHECK_DIR, append } from "../log.js";
import { makePayer } from "../pay.js";
import { selfCheck } from "../self-check.js";
import { loadLocalKeys, walletStatus } from "../wallet-env.js";

loadLocalKeys();
const w = walletStatus();
if (!w.usable) {
  append(SELF_CHECK_DIR(), { kind: "run_skipped", host: "-", run: "self_check", reason: "secrets not configured (未設定)", missing: w.missing });
  console.log(`self-check: skipped — secrets not configured (未設定): ${w.missing.join(", ")}`);
  process.exit(0);
}
// The self-check pays for real (one call per own seller). It waits for the same switch
// as the paid probe, which is turned on only after a dry run has been checked.
if (process.env.GITHUB_ACTIONS && process.env.PROBE_PAID_ENABLED !== "true") {
  append(SELF_CHECK_DIR(), { kind: "run_skipped", host: "-", run: "self_check", reason: "paid runs not enabled (PROBE_PAID_ENABLED != true)" });
  console.log("self-check: skipped — PROBE_PAID_ENABLED is not true (set it after the dry run has been checked)");
  process.exit(0);
}
const results = await selfCheck(await makePayer());
for (const r of results) console.log(JSON.stringify({ target: r.target, replay: r.replay, cache: r.cache, tx: (r.paid as any)?.tx }));
