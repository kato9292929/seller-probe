// What the page shows for the curated purchases (dist/data/curated.json): the definitions, the
// curation (candidates, exclusions by reason, the kept list), the latest purchase of each kept
// endpoint with its evidence, older bare-GET "paid, not delivered" purchases re-read into the same
// categories (read time only; log/ is not rewritten), and the self-checks of JIN and OSD apart.
import { outcomeOf } from "../outcome.js";
import type { CuratedFile } from "./curate.js";
import { REASONS } from "./curate.js";
import { CATEGORIES, type Category, DEFINITIONS, categorize } from "./judge.js";

type Row = Record<string, unknown> & { ts: string; kind: string; host: string };

/** The request as published: method, URL, parameters and where each value came from. Never a payment header. */
const publicRequest = (r: any) =>
  r ? { method: r.method, url: r.url, query: r.query ?? {}, body: r.body ?? null, source: r.source, source_detail: r.source_detail, values: r.values ?? [] } : null;

function evidence(r: Row) {
  const c = categorize(r);
  return {
    ts: r.ts, date: r.ts.slice(0, 10),
    category: c?.category ?? null, category_label: c ? CATEGORIES[c.category] : null, reason: c?.reason ?? null,
    request: publicRequest(r.request), request_tried: (r.request_tried as string[] | undefined) ?? null,
    http_status: (r.http_status ?? null) as number | null, response_sha256: (r.response_sha256 ?? null) as string | null, response_bytes: (r.response_bytes ?? null) as number | null,
    tx: (r.tx ?? null) as string | null, chain: (r.chain ?? null) as string | null, network: (r.network ?? null) as string | null, amount: (r.amount ?? null) as string | null,
    onchain_ok: (r.onchain_ok ?? null) as boolean | null,
    checks: (r.checks as unknown[] | undefined) ?? null, body_head: (r.body_head ?? null) as string | null,
    error_body: (r.error_body ?? null) as string | null, skipped: (r.skipped ?? null) as string | null,
  };
}

export function curatedReport(a: { records: Row[]; selfChecks: Row[]; curated: CuratedFile | null; now: Date }) {
  const curatedRows = a.records.filter((r) => r.kind === "paid" && r.pick === "curated" && !r.dry_run);
  const latest = new Map<string, Row>();
  for (const r of curatedRows) {
    const id = String(r.curated_id);
    const cur = latest.get(id);
    if (!cur || r.ts > cur.ts) latest.set(id, r);
  }
  const items = (a.curated?.items ?? []).map((i) => ({
    id: i.id, operator: i.operator_name, host: i.host, url: i.url, name: i.name, description: i.description, category: i.category,
    price_usd: i.price_usd, reasons: i.reasons,
    last: latest.has(i.id) ? evidence(latest.get(i.id)!) : null,
  }));
  const counts = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0])) as Record<Category, number>;
  for (const it of items) if (it.last?.category) counts[it.last.category as Category]++;
  const lastRun = [...latest.values()].map((r) => r.ts).sort().at(-1) ?? null;

  // Older purchases (bare GET, before 2026-11-08) whose outcome was "paid, not delivered", re-read.
  const legacy: Record<string, { not_delivered: number; by_category: Partial<Record<Category, number>>; rows: { host: string; url: string; http_status: unknown; category: string; reason: string }[] }> = {};
  for (const r of a.records) {
    if (r.kind !== "paid" || r.pick === "curated" || r.skipped || r.dry_run) continue;
    if (outcomeOf(r) !== "not_delivered") continue;
    const d = r.ts.slice(0, 10);
    const c = categorize(r)!;
    const g = (legacy[d] ??= { not_delivered: 0, by_category: {}, rows: [] });
    g.not_delivered++;
    g.by_category[c.category] = (g.by_category[c.category] ?? 0) + 1;
    g.rows.push({ host: r.host, url: String(r.url), http_status: r.http_status ?? null, category: CATEGORIES[c.category], reason: c.reason });
  }

  // JIN and OSD: the operator's own sellers, measured by the self-check (not in the curated list).
  const own = new Map<string, Row>();
  for (const r of a.selfChecks) {
    if (r.kind !== "self_check") continue;
    const cur = own.get(r.host);
    if (!cur || r.ts > cur.ts) own.set(r.host, r);
  }
  const ownSellers = [...own.values()].map((r) => {
    const p = { ...((r.paid as Row | undefined) ?? {}), kind: "paid" } as Row;
    const c = categorize(p);
    return {
      target: (r.target ?? r.host) as string, host: r.host, date: r.ts.slice(0, 10), url: (p.url ?? null) as string | null,
      category: c ? CATEGORIES[c.category] : null, reason: c?.reason ?? null,
      http_status: (p.http_status ?? null) as number | null, tx: (p.tx ?? null) as string | null, chain: (p.chain ?? null) as string | null,
      response_sha256: (p.response_sha256 ?? null) as string | null, receipt_ok: (p.receipt_ok ?? null) as boolean | null,
    };
  });

  const cur = a.curated;
  return {
    generated_at: a.now.toISOString(),
    last_run: lastRun,
    categories: Object.entries(CATEGORIES).map(([k, label]) => ({ key: k, label, definition: DEFINITIONS[k as Category], count: counts[k as Category] })),
    curation: cur
      ? {
          generated_at: cur.generated_at, rules: cur.rules, sources: cur.sources, candidates: cur.candidates, kept: cur.items.length,
          operators_kept: new Set(cur.items.map((i) => i.operator)).size,
          excluded_by_reason: Object.entries(cur.excluded_counts).map(([k, n]) => ({ key: k, label: (REASONS as Record<string, string>)[k] ?? k, count: n })),
          excluded_operators: cur.excluded.filter((e) => e.scope === "operator").map((e) => ({ host: e.host, name: e.operator, reason: (REASONS as Record<string, string>)[e.reason] ?? e.reason, detail: e.detail })),
        }
      : null,
    items,
    legacy_not_delivered: Object.entries(legacy).sort(([x], [y]) => x.localeCompare(y)).map(([date, g]) => ({ date, ...g, by_category: Object.entries(g.by_category).map(([k, n]) => ({ key: k, label: CATEGORIES[k as Category], count: n })) })),
    own_sellers: ownSellers,
  };
}
