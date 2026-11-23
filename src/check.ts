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
export type CheckItem = { id: string; label: string; status: CheckStatus; detail: string; fix: string | null; link?: string };

/** Integration steps for Delivery Receipt (npm @x402jp/delivery-receipt-seller). */
export const RECEIPT_GUIDE = "https://github.com/kato9292929/delivery-receipt#組み込み手順";
export type CheckReport = { url: string; host: string; checked_at: string; items: CheckItem[] };

/** Language of the messages (GET /check?url=…&lang=en|zh; Japanese by default). */
export type CheckLang = "ja" | "en" | "zh";
type Msg = { ja: string; en: string; zh: string };
export const checkLangOf = (v: string | null | undefined): CheckLang => (v === "en" || v === "zh" ? v : "ja");

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
export async function validateTarget(raw: string, resolve = lookup, lang: CheckLang = "ja"): Promise<{ url: URL } | { error: string }> {
  const err = (m: Msg) => ({ error: m[lang] });
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return err({ ja: "URL として読めません", en: "Not a readable URL", zh: "无法识别为 URL" });
  }
  if (u.protocol !== "https:") return err({ ja: "https の URL だけを検査します", en: "Only https URLs are checked", zh: "只检查 https 的 URL" });
  if (u.username || u.password) return err({ ja: "認証情報を含む URL は検査しません", en: "URLs with credentials are not checked", zh: "不检查含认证信息的 URL" });
  if (u.port && u.port !== "443") return err({ ja: "443 以外のポートは検査しません", en: "Only port 443 is checked", zh: "不检查 443 以外的端口" });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || !host.includes("."))
    return err({ ja: "公開されたホスト名の URL だけを検査します", en: "Only URLs with a public host name are checked", zh: "只检查使用公开主机名的 URL" });
  try {
    const addrs = await resolve(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
      return err({ ja: "公開されていないアドレスのホストは検査しません", en: "Hosts on non-public addresses are not checked", zh: "不检查非公开地址的主机" });
  } catch {
    return err({ ja: "ホスト名を引けません", en: "The host name does not resolve", zh: "无法解析主机名" });
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

/** For a 402 that says x402Version 2: does it look like v2 (resource object, amount, not v1-only fields)? */
export function v2Layout(p: Parsed402, lang: CheckLang = "ja"): { ok: boolean; problems: string[] } | null {
  if (p.spec_version !== "v2") return null;
  const doc: any = p.raw;
  const problems: string[] = [];
  if (!doc?.resource || typeof doc.resource !== "object" || typeof doc.resource.url !== "string") problems.push({ ja: "resource オブジェクトがない", en: "no resource object", zh: "没有 resource 对象" }[lang]);
  const accepts: any[] = Array.isArray(doc?.accepts) ? doc.accepts : [];
  if (accepts.some((x) => x?.maxAmountRequired !== undefined && x?.amount === undefined)) problems.push({ ja: "amount ではなく v1 の maxAmountRequired", en: "v1 maxAmountRequired instead of amount", zh: "使用了 v1 的 maxAmountRequired 而不是 amount" }[lang]);
  if (accepts.some((x) => typeof x?.network === "string" && !x.network.includes(":"))) problems.push({ ja: "network が CAIP-2 でない", en: "network is not CAIP-2", zh: "network 不是 CAIP-2 格式" }[lang]);
  return { ok: problems.length === 0, problems };
}

/** The Probe's record of this host (its public /scores/:host document), if any. */
export type ProbeRecord = {
  last_paid?: { date: string; outcome: string | null; price_usd: number | null } | null;
  last_rejection?: { ts: string; http_status: number | null; error: string | null } | null;
  requires_input_reason?: { reason: string } | null;
} | null;

export async function checkSeller(
  url: URL,
  deps: { get?: Get; probeRecord?: (host: string) => Promise<ProbeRecord>; wellKnown?: typeof wellKnownOf; lang?: CheckLang } = {},
): Promise<CheckReport> {
  const get = deps.get ?? bareGet;
  const lang = deps.lang ?? "ja";
  const T = (m: Msg) => m[lang];
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const items: CheckItem[] = [];
  let parsed: Parsed402 | null = null;
  const L = {
    status_402: T({ ja: "402 を返すか", en: "Returns 402", zh: "是否返回 402" }),
    fields: T({ ja: "402 の必須項目", en: "Required fields of the 402", zh: "402 的必填字段" }),
    usdc: T({ ja: "asset が公式 USDC か", en: "Asset is official USDC", zh: "asset 是否为官方 USDC" }),
    eip712: T({ ja: "EIP-712 の name・version", en: "EIP-712 name and version", zh: "EIP-712 的 name・version" }),
    input: T({ ja: "入力スキーマ", en: "Input schema", zh: "输入模式" }),
    payment_identifier: T({ ja: "支払い識別子", en: "Payment identifier", zh: "付款标识" }),
    v2_layout: T({ ja: "x402 v2 の形式", en: "x402 v2 layout", zh: "x402 v2 的格式" }),
    receipt: "Delivery Receipt",
    probe: T({ ja: "Probe の記録", en: "Probe record", zh: "Probe 的记录" }),
  };

  try {
    const r = await get(url.toString());
    if (r.status === 402) {
      parsed = parse402(r.header, r.body);
      const v = parsed.spec_version ?? T({ ja: "形式不明", en: "unknown version", zh: "格式不明" });
      items.push(item("status_402", L.status_402, "pass", T({ ja: `支払いなしの GET に 402（${v}）`, en: `402 to an unpaid GET (${v})`, zh: `不付款的 GET 返回 402（${v}）` })));
    } else {
      items.push(item("status_402", L.status_402, "fail",
        T({ ja: `支払いなしの GET に HTTP ${r.status}`, en: `HTTP ${r.status} to an unpaid GET`, zh: `不付款的 GET 返回 HTTP ${r.status}` }),
        r.status >= 300 && r.status < 400
          ? T({ ja: "リダイレクトせず、この URL 自体で 402 を返す", en: "Return the 402 from this URL itself, without redirecting", zh: "不要重定向，由该 URL 本身返回 402" })
          : T({ ja: "支払いのない GET に 402 と支払い条件（v2 は PAYMENT-REQUIRED ヘッダ）を返す", en: "Answer an unpaid GET with 402 and the payment requirements (in v2, the PAYMENT-REQUIRED header)", zh: "对不付款的 GET 返回 402 和付款条件（v2 为 PAYMENT-REQUIRED 头）" })));
    }
  } catch (e) {
    items.push(item("status_402", L.status_402, "fail",
      T({ ja: `接続できない（${errMsg(e)}）`, en: `Cannot connect (${errMsg(e)})`, zh: `无法连接（${errMsg(e)}）` }),
      T({ ja: "公開の https で応答できるようにする", en: "Make it answer over public https", zh: "使其能通过公开的 https 响应" })));
  }

  const a = parsed ? primaryAccept(parsed) : undefined;
  const noTerms = T({ ja: "支払い条件がない", en: "No payment terms", zh: "没有付款条件" });
  if (!parsed) {
    for (const id of ["fields", "usdc", "eip712", "input", "payment_identifier"] as const)
      items.push(item(id, L[id], "na", T({ ja: "402 が返らないため検査できない", en: "Cannot be checked: no 402", zh: "未返回 402，无法检查" })));
  } else if (!a) {
    items.push(item("fields", L.fields, "fail",
      parsed.error ?? T({ ja: "Solana / Base mainnet の支払い条件（accepts）がない", en: "No payment terms (accepts) for Solana / Base mainnet", zh: "没有 Solana / Base 主网的付款条件（accepts）" }),
      T({ ja: "accepts に scheme・network（solana:5eykt4… または eip155:8453）・asset・payTo・amount・resource を入れる", en: "Put scheme, network (solana:5eykt4… or eip155:8453), asset, payTo, amount and resource in accepts", zh: "在 accepts 中写入 scheme、network（solana:5eykt4… 或 eip155:8453）、asset、payTo、amount、resource" })));
    items.push(item("usdc", L.usdc, "na", noTerms));
    items.push(item("eip712", L.eip712, "na", noTerms));
  } else {
    const probs = fieldProblems(a);
    items.push(probs.length
      ? item("fields", L.fields, "fail", probs.join("; "),
        T({ ja: "scheme・network・asset・payTo・金額（v2 は amount、v1 は maxAmountRequired）・resource をすべて入れる", en: "Include all of scheme, network, asset, payTo, the amount (amount in v2, maxAmountRequired in v1) and resource", zh: "写全 scheme、network、asset、payTo、金额（v2 为 amount，v1 为 maxAmountRequired）、resource" }))
      : item("fields", L.fields, "pass", `scheme ${a.scheme}・${a.network}・amount ${a.amount}・payTo ${a.payTo}`));
    const chain = a.chain === "base" ? "Base" : "Solana";
    items.push(isOfficialUsdc(a)
      ? item("usdc", L.usdc, "pass", T({ ja: `${chain} の公式 USDC（${a.asset}）`, en: `Official USDC on ${chain} (${a.asset})`, zh: `${chain} 的官方 USDC（${a.asset}）` }))
      : item("usdc", L.usdc, "fail",
        T({ ja: `asset ${a.asset ?? "なし"} は公式 USDC ではない`, en: `Asset ${a.asset ?? "(none)"} is not official USDC`, zh: `asset ${a.asset ?? "（无）"} 不是官方 USDC` }),
        a.chain === "base"
          ? T({ ja: "asset を 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 にする", en: "Set asset to 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", zh: "将 asset 设为 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" })
          : T({ ja: "asset を EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v にする", en: "Set asset to EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", zh: "将 asset 设为 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" })));
    if (a.chain === "base") {
      const extra: any = (a.raw as any)?.extra ?? {};
      items.push(extra.name && extra.version
        ? item("eip712", L.eip712, "pass", `extra.name "${extra.name}"・extra.version "${extra.version}"`)
        : item("eip712", L.eip712, "fail",
          T({ ja: "extra に name・version がない（買い手が EIP-3009 の署名を作れない）", en: "extra has no name and version (buyers cannot build the EIP-3009 signature)", zh: "extra 中没有 name・version（买家无法生成 EIP-3009 签名）" }),
          T({ ja: 'extra に name: "USD Coin", version: "2" を入れる', en: 'Put name: "USD Coin", version: "2" in extra', zh: '在 extra 中写入 name: "USD Coin", version: "2"' })));
    } else items.push(item("eip712", L.eip712, "na", T({ ja: "Base の支払い条件ではない", en: "Not a Base payment", zh: "不是 Base 的付款条件" })));
  }

  if (parsed) {
    // A 402 that says v2 but is laid out as v1 (no top-level resource object, v1-only fields):
    // seen 2026-11-03 at a seller that refused a v2 payment (PAYMENT-SIGNATURE) and accepted the
    // same payment as v1 (X-PAYMENT). Confirmed only by paying, so this is a warning, not a failure.
    const v2Doc = v2Layout(parsed, lang);
    if (v2Doc) items.push(v2Doc.ok
      ? item("v2_layout", L.v2_layout, "pass", T({ ja: "v2 の 402：resource と accepts[].amount がそろっている", en: "A v2 402: resource and accepts[].amount are both present", zh: "v2 的 402：resource 和 accepts[].amount 都齐全" }))
      : item("v2_layout", L.v2_layout, "warn",
        T({
          ja: `v2 を名乗っているが v2 の形になっていない（${v2Doc.problems.join("・")}）。v1 のヘッダ（X-PAYMENT）しか読まない実装の可能性がある`,
          en: `Says v2 but is not laid out as v2 (${v2Doc.problems.join("; ")}). The server may read only the v1 header (X-PAYMENT)`,
          zh: `声称是 v2 但不是 v2 的格式（${v2Doc.problems.join("・")}）。服务器可能只读取 v1 的头（X-PAYMENT）`,
        }),
        T({
          ja: "v2 の買い手は PAYMENT-SIGNATURE ヘッダで払う。サーバが PAYMENT-SIGNATURE を読むようにし、402 は x402 v2 の形（resource オブジェクト、accepts[].amount、extra.name・version）で返す",
          en: "v2 buyers pay with the PAYMENT-SIGNATURE header. Have the server read PAYMENT-SIGNATURE, and return the 402 in the x402 v2 layout (resource object, accepts[].amount, extra.name and version)",
          zh: "v2 买家用 PAYMENT-SIGNATURE 头付款。请让服务器读取 PAYMENT-SIGNATURE，并以 x402 v2 的格式返回 402（resource 对象、accepts[].amount、extra.name・version）",
        })));
    const need = inputRequirement(parsed);
    const doc: any = parsed.raw;
    const declared = !!doc?.extensions?.bazaar || parsed.accepts.some((x) => (x.raw as any)?.outputSchema?.input);
    items.push(need.requires
      ? item("input", L.input, "info", T({
        ja: `必須の入力あり（${need.reason}、${need.source}）。入力なしの GET では買えないので、Probe の有料測定の対象外`,
        en: `Requires input (${need.reason}, ${need.source}). It cannot be bought with a bare GET, so the Probe's bare-GET paid measurement skips it`,
        zh: `有必填输入（${need.reason}，${need.source}）。无法用无输入的 GET 购买，因此不在 Probe 的无输入付费测量范围内`,
      }), null)
      : declared
        ? item("input", L.input, "pass", T({ ja: "入力スキーマあり・必須の入力なし（入力なしの GET で買える）", en: "Input schema present, nothing required (buyable with a bare GET)", zh: "有输入模式且无必填输入（可用无输入的 GET 购买）" }))
        : item("input", L.input, "warn",
          T({ ja: "入力スキーマがない（入力が不要なら問題ないが、必要なら買い手には分からない）", en: "No input schema (fine if no input is needed; if it is, buyers cannot tell)", zh: "没有输入模式（若不需要输入则无妨；若需要，买家无从得知）" }),
          T({ ja: "必須の入力があるなら extensions.bazaar（v2）か accepts[].outputSchema.input（v1）に書く", en: "If input is required, describe it in extensions.bazaar (v2) or accepts[].outputSchema.input (v1)", zh: "如有必填输入，请写在 extensions.bazaar（v2）或 accepts[].outputSchema.input（v1）中" })));
    const pid = doc?.extensions?.["payment-identifier"];
    items.push(pid?.info?.required === true
      ? item("payment_identifier", L.payment_identifier, "info",
        T({ ja: "payment-identifier を必須にしている（対応していない買い手は買えない）", en: "payment-identifier is required (buyers without support cannot buy)", zh: "要求必须提供 payment-identifier（不支持的买家无法购买）" }),
        T({ ja: "必須にするなら、識別子がない支払いには error を付けた 402 で理由を返す", en: "If it is required, answer a payment without one with a 402 that carries an error explaining why", zh: "如果设为必须，对没有标识的付款请返回带 error 的 402 说明原因" }))
      : pid
        ? item("payment_identifier", L.payment_identifier, "pass", T({ ja: "payment-identifier を任意で受け付ける", en: "payment-identifier accepted, optional", zh: "可选地接受 payment-identifier" }))
        : item("payment_identifier", L.payment_identifier, "info", T({ ja: "payment-identifier の宣言なし（必須にしていない）", en: "No payment-identifier declared (not required)", zh: "未声明 payment-identifier（并非必须）" })));
  }

  // No redirects here either: the checked host must not be able to point the check elsewhere.
  const wk = await (deps.wellKnown ?? ((u: string) => wellKnownOf(u, 5000, "manual")))(url.toString());
  items.push(wk.advertised === true
    ? item("receipt", L.receipt, "pass", T({
      ja: `/.well-known/x402-receipt.json あり（鍵 ${wk.wellKnown!.keys.length} 本・再取得 ${Math.round(wk.wellKnown!.refetch_window_s / 3600)} 時間）`,
      en: `/.well-known/x402-receipt.json present (${wk.wellKnown!.keys.length} key(s), refetch every ${Math.round(wk.wellKnown!.refetch_window_s / 3600)} h)`,
      zh: `有 /.well-known/x402-receipt.json（密钥 ${wk.wellKnown!.keys.length} 个，重新获取间隔 ${Math.round(wk.wellKnown!.refetch_window_s / 3600)} 小时）`,
    }))
    : item("receipt", L.receipt, "warn",
      wk.advertised === false
        ? T({ ja: `/.well-known/x402-receipt.json なし（${wk.error ?? "鍵がない"}）`, en: `No /.well-known/x402-receipt.json (${wk.error ?? "no keys"})`, zh: `没有 /.well-known/x402-receipt.json（${wk.error ?? "没有密钥"}）` })
        : T({ ja: `確認できない（${wk.error}）`, en: `Could not check (${wk.error})`, zh: `无法确认（${wk.error}）` }),
      T({
        ja: "npm の @x402jp/delivery-receipt-seller を x402 ミドルウェアの後段に入れ、/.well-known/x402-receipt.json を出す（任意。Probe は減点しない）",
        en: "Add npm @x402jp/delivery-receipt-seller after your x402 middleware and serve /.well-known/x402-receipt.json (optional; the Probe takes no points off without it)",
        zh: "在 x402 中间件之后加入 npm 的 @x402jp/delivery-receipt-seller，并提供 /.well-known/x402-receipt.json（可选，Probe 不会因此扣分）",
      })));
  if (wk.advertised !== true) items[items.length - 1].link = RECEIPT_GUIDE;

  // Settlement headers need a payment: not tested here. The Probe's paid record is shown instead.
  let rec: ProbeRecord = null;
  try {
    rec = deps.probeRecord ? await deps.probeRecord(host) : null;
  } catch {
    rec = null;
  }
  const lp = rec?.last_paid;
  if (!lp) {
    const skip = rec?.requires_input_reason ? T({ ja: `（対象外：${rec.requires_input_reason.reason}）`, en: ` (skipped: ${rec.requires_input_reason.reason})`, zh: `（不在范围内：${rec.requires_input_reason.reason}）` }) : "";
    items.push(item("probe", L.probe, "info", T({
      ja: `有料測定の記録なし${skip}。決済ヘッダ（PAYMENT-RESPONSE）を返すかは支払わないと分からないため、ここでは検査しない`,
      en: `No paid measurement on record${skip}. Whether the settlement header (PAYMENT-RESPONSE) comes back can only be known by paying, so it is not checked here`,
      zh: `没有付费测量的记录${skip}。是否返回结算头（PAYMENT-RESPONSE）只有付款后才能知道，因此这里不检查`,
    })));
  } else {
    const label: Record<string, Msg> = {
      delivered: { ja: "納品", en: "delivered", zh: "已交付" },
      not_delivered: { ja: "払ったのに届かない", en: "paid but not delivered", zh: "付了款却未送达" },
      request_rejected: { ja: "購入不成立", en: "purchase not completed", zh: "购买未成立" },
      delivered_unsettled: { ja: "送金なしで納品", en: "delivered without payment", zh: "未付款即交付" },
      failed: { ja: "失敗", en: "failed", zh: "失败" },
    };
    const st: CheckStatus = lp.outcome === "delivered" ? "pass" : lp.outcome === "request_rejected" || lp.outcome === "delivered_unsettled" ? "warn" : "fail";
    const why = lp.outcome === "request_rejected" && rec?.last_rejection?.error ? `${lang === "en" ? ": " : "："}${rec.last_rejection.error.slice(0, 160)}` : "";
    const fix: Record<string, Msg> = {
      not_delivered: { ja: "settle が成功したら必ず 200 と本文を返す（settle 後に落ちない）", en: "Once settle succeeds, always return 200 with the body (do not fail after settling)", zh: "settle 成功后务必返回 200 和正文（settle 之后不要出错）" },
      request_rejected: { ja: "入力なしの GET で買えるようにするか、必須の入力を 402 の入力スキーマに書く", en: "Make it buyable with a bare GET, or describe the required input in the 402's input schema", zh: "使其可用无输入的 GET 购买，或在 402 的输入模式中写明必填输入" },
      delivered_unsettled: { ja: "支払いを settle してから本文を返し、PAYMENT-RESPONSE ヘッダを付ける", en: "Settle the payment before returning the body, and add the PAYMENT-RESPONSE header", zh: "先 settle 付款再返回正文，并附上 PAYMENT-RESPONSE 头" },
      failed: { ja: "支払い付きの GET に 200 と本文、PAYMENT-RESPONSE ヘッダを返す", en: "Answer a paid GET with 200, the body and the PAYMENT-RESPONSE header", zh: "对带付款的 GET 返回 200、正文和 PAYMENT-RESPONSE 头" },
    };
    const outcome = label[lp.outcome ?? ""] ? T(label[lp.outcome ?? ""]) : lp.outcome;
    items.push(item("probe", L.probe, st,
      T({ ja: `${lp.date} の有料測定：${outcome}${why}`, en: `Paid measurement on ${lp.date}: ${outcome}${why}`, zh: `${lp.date} 的付费测量：${outcome}${why}` }),
      lp.outcome && fix[lp.outcome] ? T(fix[lp.outcome]) : null));
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
  const lang = checkLangOf(self.searchParams.get("lang"));
  const T = (m: Msg) => m[lang];
  if (!raw) return json(400, { error: T({ ja: "url を指定してください（GET /check?url=https://…）", en: "Give a url (GET /check?url=https://…)", zh: "请指定 url（GET /check?url=https://…）" }) });
  const v = await validateTarget(raw, deps.resolve, lang);
  if ("error" in v) return json(400, { error: v.error });
  const host = v.url.hostname.toLowerCase().replace(/^www\./, "");
  const wait = rateLimit(seen, host);
  if (wait)
    return json(429, { error: T({ ja: `同じホストの検査は 1 分に 1 回までです（あと ${wait} 秒）`, en: `One check per host per minute (wait ${wait} s)`, zh: `同一主机每分钟只能检查 1 次（还需等待 ${wait} 秒）` }) }, { "retry-after": String(wait) });
  const probeRecord = deps.probeRecord ?? (async (h: string) => {
    const r = await fetch(`${self.origin}/data/hosts/${encodeURIComponent(h)}.json`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? ((await r.json()) as ProbeRecord) : null;
  });
  return json(200, await checkSeller(v.url, { ...deps, probeRecord, lang }));
}
