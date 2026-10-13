// §3.3 Tests that are attacks if aimed at someone else, so they run ONLY against our
// own sellers (OSD, JIN): replaying a used payment header, and serving a paid
// response from cache. Results go to self-check/, never into the public score.
import { hostKey } from "./catalog.js";
import { errMsg, timedGet } from "./http.js";
import { SELF_CHECK_DIR, append } from "./log.js";
import type { Payer } from "./pay.js";
import { probePaid, toRecord } from "./probe-paid.js";

/** Our own sellers. The allowlist is hard-coded on purpose; URLs come from env but must be on these hosts. */
export const SELF_HOSTS = ["jin.x402jp.com", "osd.x402jp.com"] as const;

export function selfTargets(): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  for (const [name, v] of [["JIN", process.env.JIN_PAID_URL || "https://jin.x402jp.com/api/jin/series"], ["OSD", process.env.OSD_PAID_URL]] as const) {
    if (!v) continue;
    const h = hostKey(v);
    if (!h || !(SELF_HOSTS as readonly string[]).includes(h)) throw new Error(`${name} self-check URL ${v} is not on an own host (${SELF_HOSTS.join(", ")})`);
    out.push({ name, url: v });
  }
  return out;
}

export async function selfCheck(payer: Payer): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  for (const s of selfTargets()) {
    const host = hostKey(s.url)!;
    const paid = await probePaid({ host, url: s.url, endpoint_id: "self", price_usd: 0, networks: [] }, {
      payer, logDir: SELF_CHECK_DIR(), attemptKind: "self_check_attempt", resultKind: "self_check", extra: { target: s.name },
    });
    const rec: Record<string, unknown> = { kind: "self_check", host, target: s.name, paid: toRecord(paid) };
    if (paid.delivered && paid._payment_headers) {
      // Replay: the exact same payment header again. Must not get the data a second time.
      try {
        const r = await timedGet(s.url, paid._payment_headers, 60_000);
        rec.replay = { http_status: r.res.status, response_bytes: r.body.length, rejected: r.res.status !== 200 };
      } catch (e) {
        rec.replay = { error: errMsg(e), rejected: null };
      }
      // Cache: no payment at all, right after a paid 200. Must be a 402, not the paid body.
      try {
        const r = await timedGet(s.url);
        const sameBody = paid._body ? r.body.equals(paid._body) : false;
        rec.cache = {
          http_status: r.res.status, same_body_as_paid: sameBody,
          age: r.res.headers.get("age"), x_vercel_cache: r.res.headers.get("x-vercel-cache"), cf_cache_status: r.res.headers.get("cf-cache-status"),
          paid_cache_control: paid.cache_control,
          safe: r.res.status === 402 && !sameBody,
        };
      } catch (e) {
        rec.cache = { error: errMsg(e), safe: null };
      }
    } else {
      rec.replay = { skipped: "paid call did not deliver" };
      rec.cache = { skipped: "paid call did not deliver" };
    }
    results.push(append(SELF_CHECK_DIR(), rec as any));
  }
  return results;
}
