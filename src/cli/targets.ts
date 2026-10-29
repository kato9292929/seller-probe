import "dotenv/config";
import { loadCatalog } from "../catalog.js";
import { fetchPopularity } from "../popularity.js";
import { exclusionReason, loadExclusions } from "../exclusions.js";
import { LOG_DIR, readRecords } from "../log.js";
import { OBSERVED_TTL_DAYS, observedRequirements } from "../observed.js";
import { errMsg, timedGet } from "../http.js";
import { buildTargets, loadProbeConfig, screenPaidTargets, writeTargets } from "../targets.js";
import { refuseReason } from "../pay.js";
import { inputRequirement, parse402, primaryAccept } from "../x402.js";

const date = process.env.PROBE_DATE ?? new Date().toISOString().slice(0, 10);
const catalog = await loadCatalog();
const pop = await fetchPopularity();
// A paid slot goes only to a host that can actually be bought with a bare GET:
// not excluded (config/exclusions.json), answers a free GET with a 402 (the same request
// the free probe makes), offers something the probe would pay (not_payable otherwise,
// e.g. an amount of 0), and declares no required input. Others are recorded
// with the reason and the next eligible host is promoted.
const exclusions = loadExclusions();
// Sellers whose own error answer to a recent purchase showed a required input (observed.ts);
// they stay out for OBSERVED_TTL_DAYS after that answer, then are measured again.
const observed = observedRequirements(readRecords(LOG_DIR(), OBSERVED_TTL_DAYS + 1));
const t = await screenPaidTargets(buildTargets(date, catalog, pop, loadProbeConfig()), async (c) => {
  const ex = exclusionReason(c, exclusions);
  if (ex) return { drop: true, reason: ex };
  const ob = observed.get(c.host);
  if (ob) return { drop: true, reason: `${ob.kind === "auth" ? "requires_auth" : "requires_input"} (observed): ${ob.reason}`, evidence: { ...ob.evidence, until: ob.until } };
  try {
    const r = await timedGet(c.url);
    if (r.res.status !== 402) return { drop: true, reason: `no_402: HTTP ${r.res.status} on GET` };
    const parsed = parse402((n) => r.res.headers.get(n), r.body.toString("utf8"));
    // Same accept rules as the purchase itself (exact, official USDC on Solana/Base, 0 < amount ≤ cap),
    // judged as if both probe wallets were configured.
    const refuse = refuseReason(primaryAccept(parsed), { solana: "any", base: "any" });
    if (refuse) return { drop: true, reason: `not_payable: ${refuse}` };
    const need = inputRequirement(parsed);
    return need.requires ? { drop: true, reason: `requires_input: ${need.reason}` } : { drop: false, reason: null };
  } catch (e) {
    return { drop: true, reason: `no_402: unreachable (${errMsg(e)})` };
  }
});
const file = writeTargets(t);
console.log(
  `targets ${date}: catalog ${t.catalog.commit?.slice(0, 7) ?? t.catalog.file} (${t.catalog.endpoints} endpoints) → ` +
    `free ${t.free.length} hosts; paid [${t.paid.phase}] top ${t.paid.top.length} + random ${t.paid.random.length}; ` +
    `dropped ${t.paid.screened?.dropped.length ?? 0} (${(t.paid.screened?.dropped ?? []).map((d) => `${d.host}: ${d.reason}`).join("; ")}); popularity ${t.popularity.metric} (${t.popularity.status}${t.popularity.note ? `: ${t.popularity.note}` : ""}) → ${file}`,
);
