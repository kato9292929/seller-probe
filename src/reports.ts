// POST /reports: anonymous purchase reports from buyers using @x402jp/safe-buy (only when the
// buyer opted in). Kept apart from the Probe's own measurements: stored in the KV, counted on the
// public page in their own line, never mixed into a score. Only the fields below are kept —
// anything identifying the buyer (payer, tx, body) is dropped even if sent.
import { type Kv, kvConfig, upstash } from "./kv.js";

export const REPORT_OUTCOMES = ["delivered", "not_delivered", "delivered_unsettled", "overcharged", "request_rejected", "failed", "refused"] as const;
const TTL_S = 400 * 86_400;
const MAX_BYTES = 4096;

export type Report = {
  v: 1; host: string; url: string; network: string | null; amount: string | null; outcome: (typeof REPORT_OUTCOMES)[number];
  http_status: number | null; latency_ms: number | null; settled_header: boolean | null; onchain_found: boolean | null;
  receipt_ok: boolean | null; refetched: boolean | null; sdk: string | null; ts: string; received_at: string;
};

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v) : null);

/** The stored form of a report, or why it is refused. */
export function normalizeReport(raw: unknown, now = new Date()): Report | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "JSON object expected" };
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return { error: "v must be 1" };
  let u: URL;
  try {
    u = new URL(String(r.url));
  } catch {
    return { error: "url must be an absolute URL" };
  }
  if (u.protocol !== "https:") return { error: "url must be https" };
  if (!REPORT_OUTCOMES.includes(r.outcome as any)) return { error: `outcome must be one of ${REPORT_OUTCOMES.join(", ")}` };
  const amount = typeof r.amount === "string" && /^\d{1,12}$/.test(r.amount) ? r.amount : null;
  const ts = typeof r.ts === "string" && !Number.isNaN(Date.parse(r.ts)) ? new Date(r.ts).toISOString() : now.toISOString();
  return {
    v: 1, host: u.hostname.toLowerCase().replace(/^www\./, ""), url: `${u.origin}${u.pathname}`,
    network: typeof r.network === "string" ? r.network.slice(0, 64) : null, amount, outcome: r.outcome as Report["outcome"],
    http_status: int(r.http_status), latency_ms: int(r.latency_ms), settled_header: bool(r.settled_header), onchain_found: bool(r.onchain_found),
    receipt_ok: bool(r.receipt_ok), refetched: bool(r.refetched), sdk: typeof r.sdk === "string" ? r.sdk.slice(0, 64) : null, ts, received_at: now.toISOString(),
  };
}

const perIp = new Map<string, number[]>();
function limited(ip: string, now = Date.now()): boolean {
  const hits = (perIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  perIp.set(ip, hits);
  if (perIp.size > 10_000) perIp.clear();
  return hits.length > 30;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" } });

export async function handleReport(req: Request, kv: Kv | null = upstash()): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } });
  if (req.method !== "POST") return json(405, { error: "POST a report" });
  if (!kv) return json(503, { error: "reports are not configured on this deployment (no KV)" });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "-";
  if (limited(ip)) return json(429, { error: "too many reports" });
  const text = await req.text();
  if (text.length > MAX_BYTES) return json(413, { error: "report too large" });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const rep = normalizeReport(raw);
  if ("error" in rep) return json(400, rep);
  const day = rep.received_at.slice(0, 10);
  await kv.pipeline([
    ["RPUSH", `reports:${day}`, JSON.stringify(rep)],
    ["EXPIRE", `reports:${day}`, TTL_S],
    ["INCR", "reports:total"],
    ["HINCRBY", "reports:hosts", rep.host, 1],
    ["HINCRBY", `reports:outcomes:${rep.host}`, rep.outcome, 1],
  ]);
  return json(202, { accepted: true });
}

/** Counts for the public page (built at deploy time); null when the KV is not configured or unreachable. */
export async function reportSummary(kv: Kv | null = upstash(kvConfig())): Promise<{ received: number; hosts: number; by_host: Record<string, number> } | null> {
  if (!kv) return null;
  try {
    const [total, hosts] = (await kv.pipeline([["GET", "reports:total"], ["HGETALL", "reports:hosts"]])) as [string | null, string[] | null];
    const by: Record<string, number> = {};
    const h = hosts ?? [];
    for (let i = 0; i + 1 < h.length; i += 2) by[h[i]] = Number(h[i + 1]);
    return { received: Number(total ?? 0), hosts: Object.keys(by).length, by_host: by };
  } catch {
    return null;
  }
}
