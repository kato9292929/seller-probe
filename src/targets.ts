// targets/YYYY-MM-DD.json: what the free and paid probes measure on a given day.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Catalog, Target } from "./catalog.js";
import { paidEligible, representatives } from "./catalog.js";
import { ROOT } from "./config.js";
import type { Popularity } from "./popularity.js";

export type ProbeConfig = { paid: { top_n: number; random_n: number; phase: string; note?: string } };

export type TargetsFile = {
  date: string;
  generated_at: string;
  catalog: Catalog["source"] & { endpoints: number; candidates_hosts: number };
  popularity: Omit<Popularity, "rows"> & { hosts: number };
  free: Target[];
  paid: {
    phase: string;
    top_n: number;
    random_n: number;
    seed: string;
    top: (Target & { tx_count: number; rank: number })[];
    random: Target[];
    /** Popular hosts left out of the paid set and why (price ceiling, not in catalog). */
    skipped_popular: { host: string; rank: number; reason: string }[];
  };
};

export const TARGETS_DIR = () => resolve(ROOT, process.env.PROBE_TARGETS_DIR ?? "targets");

/** Deterministic PRNG (mulberry32) seeded from a string, so the random draw is reproducible from the date. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTargets(date: string, catalog: Catalog, pop: Popularity, cfg: ProbeConfig): TargetsFile {
  const free = representatives(catalog.endpoints);
  const byHost = new Map(free.map((t) => [t.host, t]));
  const top: TargetsFile["paid"]["top"] = [];
  const skipped: TargetsFile["paid"]["skipped_popular"] = [];
  pop.rows.forEach((row, i) => {
    if (top.length >= cfg.paid.top_n) return;
    const t = byHost.get(row.host);
    if (!t) return void skipped.push({ host: row.host, rank: i + 1, reason: "no Solana/Base USDC endpoint in catalog" });
    if (!paidEligible(t)) return void skipped.push({ host: row.host, rank: i + 1, reason: `cheapest price $${t.price_usd} > $0.01` });
    top.push({ ...t, tx_count: row.tx_count, rank: i + 1 });
  });
  const taken = new Set(top.map((t) => t.host));
  const pool = free.filter((t) => paidEligible(t) && !taken.has(t.host));
  const seed = `seller-probe:${date}`;
  const rand = rng(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const { rows, ...popMeta } = pop;
  return {
    date,
    generated_at: new Date().toISOString(),
    catalog: { ...catalog.source, endpoints: catalog.endpoints.length, candidates_hosts: free.length },
    popularity: { ...popMeta, hosts: rows.length },
    free,
    paid: {
      phase: cfg.paid.phase, top_n: cfg.paid.top_n, random_n: cfg.paid.random_n, seed,
      top, random: pool.slice(0, cfg.paid.random_n), skipped_popular: skipped,
    },
  };
}

export function writeTargets(t: TargetsFile): string {
  mkdirSync(TARGETS_DIR(), { recursive: true });
  const file = resolve(TARGETS_DIR(), `${t.date}.json`);
  writeFileSync(file, JSON.stringify(t, null, 1) + "\n");
  return file;
}

export function latestTargets(): TargetsFile {
  const dir = TARGETS_DIR();
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
  if (!files.length) throw new Error(`no targets in ${dir}; run npm run targets first`);
  return JSON.parse(readFileSync(resolve(dir, files.at(-1)!), "utf8"));
}

export function loadProbeConfig(): ProbeConfig {
  return JSON.parse(readFileSync(resolve(ROOT, "config/probe.json"), "utf8"));
}
