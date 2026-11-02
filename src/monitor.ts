// Seller monitoring (§4 of the 2026-11-02 brief). A seller registers one URL and a webhook for 30 days
// (POST /monitor, paid with x402: $0.10). Every day the Probe measures that URL without paying, as the
// free probe does, and posts to the webhook when something changed: no 402 any more, the 402's format
// broke, the price changed, payTo changed, or the Delivery Receipt keys disappeared. When the Probe's
// weekly purchase includes the host, the outcome and the seller's stated reason are posted too.
// Each POST carries X-Probe-Signature: sha256=<HMAC-SHA256 of the body with the secret given at registration>.
import { createHmac, randomBytes } from "node:crypto";
import { validateTarget } from "./check.js";
import { type Kv, upstash } from "./kv.js";
import type { Prepared } from "./paywall.js";

export const MONITOR_DAYS = 30;
export const MONITOR_PRICE = "$0.10";

export type Monitor = { id: string; url: string; host: string; webhook: string; secret: string; created_at: string; expires_at: string };
/** What is compared day to day (from a bare GET, like the free probe). */
export type MonitorState = { at: string; status_402: boolean; fields_valid: boolean; amount: string | null; pay_to: string | null; network: string | null; receipt_advertised: boolean | null; http_status: number | null };
export type Change = { kind: "no_402" | "format_broken" | "price_changed" | "payto_changed" | "receipt_keys_gone" | "recovered"; from: unknown; to: unknown };

const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");

/** Pure: what changed between two daily states. */
export function changes(prev: MonitorState | null, cur: MonitorState): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  if (prev.status_402 && !cur.status_402) out.push({ kind: "no_402", from: 402, to: cur.http_status });
  if (!prev.status_402 && cur.status_402) out.push({ kind: "recovered", from: prev.http_status, to: 402 });
  if (prev.status_402 && cur.status_402 && prev.fields_valid && !cur.fields_valid) out.push({ kind: "format_broken", from: true, to: false });
  if (prev.amount && cur.amount && prev.amount !== cur.amount) out.push({ kind: "price_changed", from: prev.amount, to: cur.amount });
  if (prev.pay_to && cur.pay_to && prev.pay_to !== cur.pay_to) out.push({ kind: "payto_changed", from: prev.pay_to, to: cur.pay_to });
  if (prev.receipt_advertised === true && cur.receipt_advertised === false) out.push({ kind: "receipt_keys_gone", from: true, to: false });
  return out;
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** POST /monitor { url, webhook }: validated before payment; stored only after settlement. */
export function prepareRegistration(kv: Kv | null = upstash(), resolve?: Parameters<typeof validateTarget>[1], now = () => new Date()) {
  return async (_req: Request, body: unknown): Promise<Prepared> => {
    if (!kv) return { refuse: json(503, { error: "monitoring is not configured on this deployment (no KV)" }) };
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.url !== "string" || typeof b.webhook !== "string") return { refuse: json(400, { error: "JSON body { url, webhook } expected" }) };
    const u = await validateTarget(b.url, resolve);
    if ("error" in u) return { refuse: json(400, { error: `url: ${u.error}` }) };
    const w = await validateTarget(b.webhook, resolve);
    if ("error" in w) return { refuse: json(400, { error: `webhook: ${w.error}` }) };
    return {
      commit: async () => {
        const t = now();
        const m: Monitor = {
          id: randomBytes(8).toString("hex"), url: u.url.toString(), host: hostOf(u.url), webhook: w.url.toString(),
          secret: randomBytes(32).toString("base64url"), created_at: t.toISOString(), expires_at: new Date(t.getTime() + MONITOR_DAYS * 86_400_000).toISOString(),
        };
        await kv.pipeline([["SET", `monitor:${m.id}`, JSON.stringify(m)], ["EXPIRE", `monitor:${m.id}`, (MONITOR_DAYS + 1) * 86_400], ["SADD", "monitors", m.id]]);
        return json(201, {
          id: m.id, url: m.url, webhook: m.webhook, expires_at: m.expires_at, secret: m.secret,
          note: "Keep the secret: every notification carries X-Probe-Signature: sha256=HMAC-SHA256(secret, body). Shown once.",
        });
      },
    };
  };
}

export async function listMonitors(kv: Kv, now = new Date()): Promise<Monitor[]> {
  const [ids] = (await kv.pipeline([["SMEMBERS", "monitors"]])) as [string[]];
  if (!ids?.length) return [];
  const got = (await kv.pipeline(ids.map((id) => ["GET", `monitor:${id}`]))) as (string | null)[];
  const out: Monitor[] = [];
  const gone: string[] = [];
  got.forEach((v, i) => {
    const m = v ? (JSON.parse(v) as Monitor) : null;
    if (!m || Date.parse(m.expires_at) <= now.getTime()) gone.push(ids[i]);
    else out.push(m);
  });
  if (gone.length) await kv.pipeline(gone.map((id) => ["SREM", "monitors", id]));
  return out;
}

export async function deliver(m: Monitor, payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch, resolve?: Parameters<typeof validateTarget>[1]): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const w = await validateTarget(m.webhook, resolve);
  if ("error" in w) return { ok: false, status: null, error: `webhook refused: ${w.error}` };
  const body = JSON.stringify({ v: 1, monitor_id: m.id, host: m.host, url: m.url, ...payload });
  try {
    const r = await fetchImpl(w.url.toString(), {
      method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "user-agent": "x402-seller-probe-monitor", "x-probe-signature": sign(m.secret, body) },
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: null, error: (e as Error).message };
  }
}
