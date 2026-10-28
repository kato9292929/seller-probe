// targets/YYYY-MM-DD.json: what the free and paid probes measure on a given day.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Catalog, Target } from "./catalog.js";
import { paidEligible, representatives } from "./catalog.js";
import { ROOT } from "./config.js";
import type { Popularity } from "./popularity.js";

/** `top_n: "all"`: every ranked host that passes screening (the whole ranking is scanned). */
export type ProbeConfig = { paid: { top_n: number | "all"; random_n: number; phase: string; note?: string } };

export const quota = (n: number | "all") => (n === "all" ? Infinity : n);

export type TargetsFile = {
  date: string;
  generated_at: string;
  catalog: Catalog["source"] & { endpoints: number; candidates_hosts: number };
  popularity: Omit<Popularity, "rows"> & { hosts: number };
  free: Target[];
  paid: {
    phase: string;
    top_n: number | "all";
    random_n: number;
    seed: string;
    top: (Target & { tx_count: number; rank: number })[];
    random: Target[];
    /** Popular hosts left out of the paid set and why (price ceiling, not in catalog, requires_input). */
    skipped_popular: { host: string; rank: number; reason: string }[];
    /** Eligible hosts in order, beyond top_n / random_n: what screening promotes from. */
    top_candidates?: (Target & { tx_count: number; rank: number })[];
    random_candidates?: Target[];
    /**
     * Set once screenPaidTargets ran. `dropped` holds every host passed over and why:
     * `excluded: <category>` (config/exclusions.json), `no_402: …` (a bare GET does not get a 402),
     * `requires_input: …` (the 402 declares a required input). `requires_input` is that subset.
     */
    screened?: {
      at: string;
      dropped: { host: string; reason: string; pick: "top" | "random"; evidence?: Record<string, unknown> }[];
      requires_input: { host: string; reason: string; pick: "top" | "random"; evidence?: Record<string, unknown> }[];
    };
  };
};

/** How many eligible hosts past the quota are kept as stand-ins for screening. */
const CANDIDATE_SLACK = 30;

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
  const n = quota(cfg.paid.top_n);
  pop.rows.forEach((row, i) => {
    if (top.length >= n + CANDIDATE_SLACK) return;
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
      top: top.slice(0, n), random: pool.slice(0, cfg.paid.random_n),
      // Only reasons for hosts that would have been in the quota; stand-ins are not "skipped".
      skipped_popular: skipped.filter((s) => s.rank <= (top[n - 1]?.rank ?? Infinity)),
      top_candidates: top, random_candidates: pool.slice(0, cfg.paid.random_n + CANDIDATE_SLACK),
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

const SCREEN_CONCURRENCY = 8;

async function mapPool<T, R>(items: T[], k: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await f(items[i]); }
  }));
  return out;
}

/** Whether a paid candidate can be bought with a bare GET, and if not, why (the reason is recorded). */
export type Screen = { drop: boolean; reason: string | null; evidence?: Record<string, unknown> };

/**
 * Fill the paid quotas from the ordered candidates, passing over every host the screen
 * drops (excluded, no 402 to a bare GET, required input) and promoting the next eligible
 * host in its place, so each slot is a host that can actually be bought.
 */
export async function screenPaidTargets(t: TargetsFile, screen: (t: Target) => Promise<Screen>): Promise<TargetsFile> {
  const dropped: { host: string; reason: string; pick: "top" | "random"; evidence?: Record<string, unknown> }[] = [];
  const fill = async <T extends Target>(cands: T[], n: number, pick: "top" | "random") => {
    // Unlimited quota: every candidate is screened anyway, so screen several at once (order kept).
    const pre = n === Infinity ? await mapPool(cands, SCREEN_CONCURRENCY, screen) : null;
    const out: T[] = [];
    for (const [i, c] of cands.entries()) {
      if (out.length >= n) break;
      const s = pre ? pre[i] : await screen(c);
      if (s.drop) dropped.push({ host: c.host, reason: s.reason ?? "dropped", pick, ...(s.evidence ? { evidence: s.evidence } : {}) });
      else out.push(c);
    }
    return out;
  };
  const top = await fill(t.paid.top_candidates ?? t.paid.top, quota(t.paid.top_n), "top");
  const taken = new Set(top.map((x) => x.host));
  const random = await fill((t.paid.random_candidates ?? t.paid.random).filter((x) => !taken.has(x.host)), t.paid.random_n, "random");
  const ranks = new Map((t.paid.top_candidates ?? []).map((c) => [c.host, c.rank]));
  return {
    ...t,
    paid: {
      ...t.paid,
      top,
      random,
      skipped_popular: [
        ...t.paid.skipped_popular,
        ...dropped.filter((d) => d.pick === "top").map((d) => ({ host: d.host, rank: ranks.get(d.host) ?? -1, reason: d.reason })),
      ].sort((a, b) => a.rank - b.rank),
      screened: {
        at: new Date().toISOString(),
        dropped,
        requires_input: dropped.filter((d) => d.reason.startsWith("requires_input")),
      },
    },
  };
}
