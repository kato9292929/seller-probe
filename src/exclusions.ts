// Sellers the paid probe must never buy from, with the reason (config/exclusions.json).
// The free probe (an unpaid GET) still measures them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";

type Exclusions = {
  hosts: { host: string; category: string; reason: string; added: string }[];
  patterns: { category: string; match: string[]; reason: string }[];
};

export function loadExclusions(): Exclusions {
  const d = JSON.parse(readFileSync(resolve(ROOT, "config/exclusions.json"), "utf8"));
  return { hosts: d.hosts ?? [], patterns: d.patterns ?? [] };
}

/** `excluded: <category>` when the target is listed or its host/URL matches an excluded pattern; else null. */
export function exclusionReason(t: { host: string; url: string }, ex: Exclusions = loadExclusions()): string | null {
  const listed = ex.hosts.find((h) => h.host === t.host);
  if (listed) return `excluded: ${listed.category}`;
  const hay = `${t.host} ${t.url}`.toLowerCase();
  for (const p of ex.patterns) {
    const hit = p.match.find((m) => hay.includes(m.toLowerCase()));
    if (hit) return `excluded: ${p.category} (matches "${hit}")`;
  }
  return null;
}
