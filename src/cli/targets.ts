import "dotenv/config";
import { loadCatalog } from "../catalog.js";
import { fetchPopularity } from "../popularity.js";
import { timedGet } from "../http.js";
import { buildTargets, loadProbeConfig, screenPaidTargets, writeTargets } from "../targets.js";
import { inputRequirement, parse402 } from "../x402.js";

const date = process.env.PROBE_DATE ?? new Date().toISOString().slice(0, 10);
const catalog = await loadCatalog();
const pop = await fetchPopularity();
// Free GET of each paid candidate's 402 (the same request the free probe makes) to read
// its declared input; unreadable answers keep the host (the paid probe records why).
const t = await screenPaidTargets(buildTargets(date, catalog, pop, loadProbeConfig()), async (c) => {
  try {
    const r = await timedGet(c.url);
    if (r.res.status !== 402) return { requires: false, reason: null };
    return inputRequirement(parse402((n) => r.res.headers.get(n), r.body.toString("utf8")));
  } catch {
    return { requires: false, reason: null };
  }
});
const file = writeTargets(t);
console.log(
  `targets ${date}: catalog ${t.catalog.commit?.slice(0, 7) ?? t.catalog.file} (${t.catalog.endpoints} endpoints) → ` +
    `free ${t.free.length} hosts; paid [${t.paid.phase}] top ${t.paid.top.length} + random ${t.paid.random.length}; ` +
    `requires_input dropped ${t.paid.screened?.requires_input.length ?? 0}; popularity ${t.popularity.metric} (${t.popularity.status}${t.popularity.note ? `: ${t.popularity.note}` : ""}) → ${file}`,
);
