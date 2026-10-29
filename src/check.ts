// §4 Seller self-check (probe.x402jp.com/check): one URL, checked on the spot WITHOUT paying.
// Only what a bare GET can show is tested; nothing that could pass for an attack (no replay,
// no load), one URL per request and at most once a minute per host. Whether the seller returns a
// settlement header cannot be known without paying, so the Probe's own paid record is shown instead.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { USER_AGENT } from "./config.js";
import { errMsg } from "./http.js";
import { wellKnownOf } from "./receipt.js";
import { type Parsed402, fieldProblems, inputRequirement, isOfficialUsdc, parse402, primaryAccept } from "./x402.js";

export type CheckStatus = "pass" | "fail" | "warn" | "info" | "na";
export type CheckItem = { id: string; label: string; status: CheckStatus; detail: string; fix: string | null };
export type CheckReport = { url: string; host: string; checked_at: string; items: CheckItem[] };

export const CHECK_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 10_000;
const MAX_BODY = 256 * 1024;

/** Private, loopback, link-local and other non-public addresses: never fetched (SSRF). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

/** The URL to check, or why it is refused: https only, a public host, no credentials, default port. */
export async function validateTarget(raw: string, resolve = lookup): Promise<{ url: URL } | { error: string }> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "URL として読めません" };
  }
  if (u.protocol !== "https:") return { error: "https の URL だけを検査します" };
  if (u.username || u.password) return { error: "認証情報を含む URL は検査しません" };
  if (u.port && u.port !== "443") return { error: "443 以外のポートは検査しません" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || !host.includes("."))
    return { error: "公開されたホスト名の URL だけを検査します" };
  try {
    const addrs = await resolve(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return { error: "公開されていないアドレスのホストは検査しません" };
  } catch {
    return { error: "ホスト名を引けません" };
  }
  return { url: u };
}

/** Per-host spacing (best effort, per server instance). Returns seconds to wait, or 0 and records the check. */
export function rateLimit(seen: Map<string, number>, host: string, now = Date.now()): number {
  const last = seen.get(host);
  if (last !== undefined && now - last < CHECK_INTERVAL_MS) return Math.ceil((CHECK_INTERVAL_MS - (now - last)) / 1000);
  seen.set(host, now);
  if (seen.size > 5000) for (const [h, t] of seen) if (now - t >= CHECK_INTERVAL_MS) seen.delete(h);
  return 0;
}

type Get = (url: string) => Promise<{ status: number; header: (n: string) => string | null; body: string }>;

/** One unpaid GET, no redirects followed (a redirect could point anywhere), body capped. */
export const bareGet: Get = async (url) => {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json, */*" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n > MAX_BODY) {
      await reader.cancel();
      break;
    }
  }
  return { status: res.status, header: (h) => res.headers.get(h), body: Buffer.concat(chunks).toString("utf8") };
};

const item = (id: string, label: string, status: CheckStatus, detail: string, fix: string | null = null): CheckItem => ({ id, label, status, detail, fix });

/** The Probe's record of this host (its public /scores/:host document), if any. */
export type ProbeRecord = {
  last_paid?: { date: string; outcome: string | null; price_usd: number | null } | null;
  last_rejection?: { ts: string; http_status: number | null; error: string | null } | null;
  requires_input_reason?: { reason: string } | null;
} | null;

export async function checkSeller(url: URL, deps: { get?: Get; probeRecord?: (host: string) => Promise<ProbeRecord>; wellKnown?: typeof wellKnownOf } = {}): Promise<CheckReport> {
  const get = deps.get ?? bareGet;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const items: CheckItem[] = [];
  let parsed: Parsed402 | null = null;

  try {
    const r = await get(url.toString());
    if (r.status === 402) {
      parsed = parse402(r.header, r.body);
      items.push(item("status_402", "402 を返すか", "pass", `支払いなしの GET に 402（${parsed.spec_version ?? "形式不明"}）`));
    } else {
      items.push(item("status_402", "402 を返すか", "fail", `支払いなしの GET に HTTP ${r.status}`,
        r.status >= 300 && r.status < 400 ? "リダイレクトせず、この URL 自体で 402 を返す" : "支払いのない GET に 402 と支払い条件（v2 は PAYMENT-REQUIRED ヘッダ）を返す"));
    }
  } catch (e) {
    items.push(item("status_402", "402 を返すか", "fail", `接続できない（${errMsg(e)}）`, "公開の https で応答できるようにする"));
  }

  const a = parsed ? primaryAccept(parsed) : undefined;
  if (!parsed) {
    for (const [id, label] of [["fields", "402 の必須項目"], ["usdc", "asset が公式 USDC か"], ["eip712", "EIP-712 の name・version"], ["input", "入力スキーマ"], ["payment_identifier", "支払い識別子"]])
      items.push(item(id, label, "na", "402 が返らないため検査できない"));
  } else if (!a) {
    items.push(item("fields", "402 の必須項目", "fail", parsed.error ?? "Solana / Base mainnet の支払い条件（accepts）がない",
      "accepts に scheme・network（solana:5eykt4… または eip155:8453）・asset・payTo・amount・resource を入れる"));
    items.push(item("usdc", "asset が公式 USDC か", "na", "支払い条件がない"));
    items.push(item("eip712", "EIP-712 の name・version", "na", "支払い条件がない"));
  } else {
    const probs = fieldProblems(a);
    items.push(probs.length
      ? item("fields", "402 の必須項目", "fail", probs.join("; "), "scheme・network・asset・payTo・金額（v2 は amount、v1 は maxAmountRequired）・resource をすべて入れる")
      : item("fields", "402 の必須項目", "pass", `scheme ${a.scheme}・${a.network}・amount ${a.amount}・payTo ${a.payTo}`));
    items.push(isOfficialUsdc(a)
      ? item("usdc", "asset が公式 USDC か", "pass", `${a.chain === "base" ? "Base" : "Solana"} の公式 USDC（${a.asset}）`)
      : item("usdc", "asset が公式 USDC か", "fail", `asset ${a.asset ?? "なし"} は公式 USDC ではない`,
        a.chain === "base" ? "asset を 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 にする" : "asset を EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v にする"));
    if (a.chain === "base") {
      const extra: any = (a.raw as any)?.extra ?? {};
      items.push(extra.name && extra.version
        ? item("eip712", "EIP-712 の name・version", "pass", `extra.name "${extra.name}"・extra.version "${extra.version}"`)
        : item("eip712", "EIP-712 の name・version", "fail", "extra に name・version がない（買い手が EIP-3009 の署名を作れない）", 'extra に name: "USD Coin", version: "2" を入れる'));
    } else items.push(item("eip712", "EIP-712 の name・version", "na", "Base の支払い条件ではない"));
  }

  if (parsed) {
    const need = inputRequirement(parsed);
    const doc: any = parsed.raw;
    const declared = !!doc?.extensions?.bazaar || parsed.accepts.some((x) => (x.raw as any)?.outputSchema?.input);
    items.push(need.requires
      ? item("input", "入力スキーマ", "info", `必須の入力あり（${need.reason}、${need.source}）。入力なしの GET では買えないので、Probe の有料測定の対象外`, null)
      : declared
        ? item("input", "入力スキーマ", "pass", "入力スキーマあり・必須の入力なし（入力なしの GET で買える）")
        : item("input", "入力スキーマ", "warn", "入力スキーマがない（入力が不要なら問題ないが、必要なら買い手には分からない）",
          "必須の入力があるなら extensions.bazaar（v2）か accepts[].outputSchema.input（v1）に書く"));
    const pid = doc?.extensions?.["payment-identifier"];
    items.push(pid?.info?.required === true
      ? item("payment_identifier", "支払い識別子", "info", "payment-identifier を必須にしている（対応していない買い手は買えない）", "必須にするなら、識別子がない支払いには error を付けた 402 で理由を返す")
      : pid
        ? item("payment_identifier", "支払い識別子", "pass", "payment-identifier を任意で受け付ける")
        : item("payment_identifier", "支払い識別子", "info", "payment-identifier の宣言なし（必須にしていない）"));
  }

  // No redirects here either: the checked host must not be able to point the check elsewhere.
  const wk = await (deps.wellKnown ?? ((u: string) => wellKnownOf(u, 5000, "manual")))(url.toString());
  items.push(wk.advertised === true
    ? item("receipt", "Delivery Receipt", "pass", `/.well-known/x402-receipt.json あり（鍵 ${wk.wellKnown!.keys.length} 本・再取得 ${Math.round(wk.wellKnown!.refetch_window_s / 3600)} 時間）`)
    : item("receipt", "Delivery Receipt", "warn", wk.advertised === false ? `/.well-known/x402-receipt.json なし（${wk.error ?? "鍵がない"}）` : `確認できない（${wk.error}）`,
      "kato9292929/delivery-receipt の packages/seller を x402 ミドルウェアの後段に入れ、/.well-known/x402-receipt.json を出す（任意。Probe は減点しない）"));

  // Settlement headers need a payment: not tested here. The Probe's paid record is shown instead.
  let rec: ProbeRecord = null;
  try {
    rec = deps.probeRecord ? await deps.probeRecord(host) : null;
  } catch {
    rec = null;
  }
  const lp = rec?.last_paid;
  if (!lp) {
    items.push(item("probe", "Probe の記録", "info", `有料測定の記録なし${rec?.requires_input_reason ? `（対象外：${rec.requires_input_reason.reason}）` : ""}。決済ヘッダ（PAYMENT-RESPONSE）を返すかは支払わないと分からないため、ここでは検査しない`));
  } else {
    const label: Record<string, string> = { delivered: "納品", not_delivered: "払ったのに届かない", request_rejected: "購入不成立", delivered_unsettled: "送金なしで納品", failed: "失敗" };
    const st: CheckStatus = lp.outcome === "delivered" ? "pass" : lp.outcome === "request_rejected" || lp.outcome === "delivered_unsettled" ? "warn" : "fail";
    const why = lp.outcome === "request_rejected" && rec?.last_rejection?.error ? `：${rec.last_rejection.error.slice(0, 160)}` : "";
    const fix: Record<string, string> = {
      not_delivered: "settle が成功したら必ず 200 と本文を返す（settle 後に落ちない）",
      request_rejected: "入力なしの GET で買えるようにするか、必須の入力を 402 の入力スキーマに書く",
      delivered_unsettled: "支払いを settle してから本文を返し、PAYMENT-RESPONSE ヘッダを付ける",
      failed: "支払い付きの GET に 200 と本文、PAYMENT-RESPONSE ヘッダを返す",
    };
    items.push(item("probe", "Probe の記録", st, `${lp.date} の有料測定：${label[lp.outcome ?? ""] ?? lp.outcome}${why}`, lp.outcome ? fix[lp.outcome] ?? null : null));
  }
  return { url: url.toString(), host, checked_at: new Date().toISOString(), items };
}

const seen = new Map<string, number>();

/** GET /check?url=… (web-standard handler; api/check.js). */
export async function handleCheck(req: Request, deps: Parameters<typeof checkSeller>[1] & { resolve?: typeof lookup } = {}): Promise<Response> {
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store", ...extra } });
  const self = new URL(req.url);
  const raw = self.searchParams.get("url");
  if (!raw) return json(400, { error: "url を指定してください（GET /check?url=https://…）" });
  const v = await validateTarget(raw, deps.resolve);
  if ("error" in v) return json(400, { error: v.error });
  const host = v.url.hostname.toLowerCase().replace(/^www\./, "");
  const wait = rateLimit(seen, host);
  if (wait) return json(429, { error: `同じホストの検査は 1 分に 1 回までです（あと ${wait} 秒）` }, { "retry-after": String(wait) });
  const probeRecord = deps.probeRecord ?? (async (h: string) => {
    const r = await fetch(`${self.origin}/data/hosts/${encodeURIComponent(h)}.json`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? ((await r.json()) as ProbeRecord) : null;
  });
  return json(200, await checkSeller(v.url, { ...deps, probeRecord }));
}
