import "dotenv/config";
import { loadCatalog } from "../catalog.js";
import { fetchPopularity } from "../popularity.js";
import { buildTargets, loadProbeConfig, writeTargets } from "../targets.js";

const date = process.env.PROBE_DATE ?? new Date().toISOString().slice(0, 10);
const catalog = await loadCatalog();
const pop = await fetchPopularity();
const t = buildTargets(date, catalog, pop, loadProbeConfig());
const file = writeTargets(t);
console.log(
  `targets ${date}: catalog ${t.catalog.commit?.slice(0, 7) ?? t.catalog.file} (${t.catalog.endpoints} endpoints) → ` +
    `free ${t.free.length} hosts; paid [${t.paid.phase}] top ${t.paid.top.length} + random ${t.paid.random.length}; ` +
    `popularity ${t.popularity.metric} (${t.popularity.status}${t.popularity.note ? `: ${t.popularity.note}` : ""}) → ${file}`,
);
