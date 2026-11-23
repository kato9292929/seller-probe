// §3: what one purchase amounts to, and whether what came back is what was described.
// Pure: works on log rows, old and new alike, so old rows are re-read at read time
// (nothing in log/ is rewritten).
import { outcomeOf } from "../outcome.js";

/** The judgment categories, in the order they are shown. Labels are the published wording. */
export const CATEGORIES = {
  as_described: "納品・説明どおり",
  not_as_described: "納品・説明と違う",
  input_mismatch: "Probeの入力が合わなかった",
  paid_then_rejected: "受け付けない要求で先に決済した",
  paid_not_delivered: "正しい要求でも届かなかった",
  delivered_without_payment: "送金なしで届いた",
  not_settled: "送金されず届かなかった",
  input_rejected_unpaid: "Probeの入力不足で断られた（送金なし）",
  no_usage: "使い方が公開されていない",
  over_price: "価格超過",
  not_bought: "買わなかった（残高・上限・対応外の支払い方法）",
} as const;
export type Category = keyof typeof CATEGORIES;

/** The same labels in English and Chinese (the page switches language). */
export const CATEGORIES_EN: Record<Category, string> = {
  as_described: "Delivered as described",
  not_as_described: "Delivered, not as described",
  input_mismatch: "The Probe's input did not fit",
  paid_then_rejected: "Took payment, then refused the request",
  paid_not_delivered: "Paid, yet not delivered",
  delivered_without_payment: "Delivered without payment",
  not_settled: "No transfer, nothing delivered",
  input_rejected_unpaid: "Refused for the Probe's missing input (no transfer)",
  no_usage: "No published usage",
  over_price: "Over the price cap",
  not_bought: "Not bought (balance, cap or unsupported payment)",
};
export const CATEGORIES_ZH: Record<Category, string> = {
  as_described: "已交付・与说明一致",
  not_as_described: "已交付・与说明不符",
  input_mismatch: "Probe 的输入不符合要求",
  paid_then_rejected: "先收款后拒绝请求",
  paid_not_delivered: "请求正确却未交付",
  delivered_without_payment: "未付款即交付",
  not_settled: "未转账，也未交付",
  input_rejected_unpaid: "因 Probe 输入不足被拒（未转账）",
  no_usage: "未公开调用方式",
  over_price: "超出价格上限",
  not_bought: "未购买（余额、上限或不支持的付款方式）",
};

/** Definitions shown on the page, one per category. */
export const DEFINITIONS: Record<Category, string> = {
  as_described: "送金が確認でき、200 で本文が届き、中身の確認（出力の型・空や誤りでない・入力の反映・鮮度・データの種類）にひとつも外れがない。",
  not_as_described: "送金が確認でき、200 で本文が届いたが、中身の確認のどれかに外れた（外れた確認と本文の先頭500文字を記録）。送金額が 402 の提示より多かった場合もここ。",
  input_mismatch: "支払う前に同じ要求を支払いなしで送ったら 402 以外（400 など）が返った。Probe 側の入力が売り手の受け付ける形に合っていないので、払っていない。",
  paid_then_rejected: "支払いなしでは 402 を返したのに、支払うと 4xx（400・405 など）で断られ、送金だけが済んだ。要求の中身を確かめる前に決済している。",
  paid_not_delivered: "支払いなしでは 402 を返し、支払って送金が確認できたのに、5xx・タイムアウトなどで中身が届かなかった。",
  delivered_without_payment: "送金が見つからない（決済ヘッダもチェーン上にもない）のに 200 で本文が届いた。",
  not_settled: "支払いを送ったが送金は起きず（決済の失敗・5xx・時間切れ・支払い後の 402）、中身も届かなかった。お金は動いていない。",
  input_rejected_unpaid: "支払いなしでは 402 が返ったので支払いを付けて送ったが、売り手が要求の中身を確かめて 4xx（400・404・422 など）で断り、送金は起きなかった。売り手が支払いの前に中身を確かめていないだけで、原因は Probe の入力不足とみなし、売り手の失敗には数えない。お金は動いていない。",
  no_usage: "402 の定義・x402 Endpoint・Bazaar・売り手の llms.txt / OpenAPI / PAY.md のどこにも呼び方が無い、または必須項目の値が決められない。払っていない。",
  over_price: "402 の提示額が 1コールの上限 $0.01 を超えた。払っていない。",
  not_bought: "残高・7日の上限・USDC 以外や対応外の支払い方法のため、払っていない（その週は測っていない）。",
};

export const DEFINITIONS_EN: Record<Category, string> = {
  as_described: "The transfer is confirmed, a 200 came back with a body, and every content check passed (output shape, not empty or an error, input reflected, freshness, kind of data).",
  not_as_described: "The transfer is confirmed and a 200 came back with a body, but a content check failed (the failed check and the first 500 characters of the body are kept). Also used when more was transferred than the 402 offered.",
  input_mismatch: "Before paying, the same request sent unpaid answered something other than 402 (such as 400). The Probe's input does not fit what the seller accepts, so nothing was paid.",
  paid_then_rejected: "Unpaid, the seller answered 402; paid, it refused with a 4xx (400, 405, …) and only the transfer went through. The seller takes payment before checking the request.",
  paid_not_delivered: "Unpaid, the seller answered 402; the payment's transfer is confirmed, yet nothing was delivered (5xx, timeout, …).",
  delivered_without_payment: "No transfer was found (no settlement header and nothing on chain), yet a 200 came back with a body.",
  not_settled: "A payment was sent but no transfer happened (settlement failure, 5xx, timeout, or a 402 after paying), and nothing was delivered. No money moved.",
  input_rejected_unpaid: "Unpaid, the seller answered 402, so the request was sent with payment; the seller then checked the request and refused it with a 4xx (400, 404, 422, …), and no transfer happened. The seller simply checks content only after the 402, so the cause is taken to be the Probe's missing input and it is not counted as the seller's failure. No money moved.",
  no_usage: "No way to call it is published anywhere (the 402, x402 Endpoint, the Bazaar, the seller's llms.txt / OpenAPI / PAY.md), or a required value cannot be determined. Nothing was paid.",
  over_price: "The 402 asked more than the $0.01 per-call cap. Nothing was paid.",
  not_bought: "Not paid because of the balance, the 7-day cap, or a payment other than USDC or unsupported (not measured that week).",
};
export const DEFINITIONS_ZH: Record<Category, string> = {
  as_described: "已确认转账，返回 200 和正文，且内容检查（输出格式、非空且非错误、输入是否反映、时效、数据种类）全部通过。",
  not_as_described: "已确认转账并返回 200 和正文，但某项内容检查未通过（记录未通过的检查和正文前 500 个字符）。转账金额超过 402 报价时也归入此类。",
  input_mismatch: "付款前先不付款发送同一请求，返回的不是 402（如 400）。Probe 的输入不符合卖家接受的格式，因此未付款。",
  paid_then_rejected: "不付款时返回 402，付款后却以 4xx（400、405 等）拒绝，只完成了转账。卖家在检查请求内容之前就已收款。",
  paid_not_delivered: "不付款时返回 402，付款后已确认转账，但因 5xx、超时等未交付内容。",
  delivered_without_payment: "找不到转账（既无结算头，链上也没有），却返回了 200 和正文。",
  not_settled: "已发送付款但未发生转账（结算失败、5xx、超时、付款后返回 402），也未交付内容。资金没有移动。",
  input_rejected_unpaid: "不付款时返回 402，于是附上付款发送请求，但卖家检查请求内容后以 4xx（400、404、422 等）拒绝，未发生转账。卖家只是在 402 之前不检查内容，原因视为 Probe 输入不足，不计为卖家的失败。资金没有移动。",
  no_usage: "在 402 定义、x402 Endpoint、Bazaar、卖家的 llms.txt / OpenAPI / PAY.md 中都找不到调用方式，或无法确定必填项的值。未付款。",
  over_price: "402 的报价超过每次调用 $0.01 的上限。未付款。",
  not_bought: "因余额、7 天上限、非 USDC 或不支持的付款方式而未付款（当周未测量）。",
};

export type Check = { name: "output_schema" | "not_empty" | "input_reflected" | "freshness" | "data_kind"; result: "pass" | "fail" | "not_checked"; detail: string };

const tryJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);
const typeOk = (want: unknown, v: unknown) => {
  const ws = (Array.isArray(want) ? want : [want]).filter((x) => typeof x === "string") as string[];
  if (!ws.length) return true;
  const t = typeOf(v);
  return ws.some((w) => w === t || (w === "number" && t === "integer"));
};

/** Required fields and types of a JSON Schema, two levels deep. */
export function schemaProblems(schema: any, v: unknown, path = "$", depth = 0): string[] {
  if (!schema || typeof schema !== "object" || depth > 2) return [];
  const out: string[] = [];
  if (schema.type && !typeOk(schema.type, v)) return [`${path}: expected ${JSON.stringify(schema.type)}, got ${typeOf(v)}`];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of Array.isArray(schema.required) ? schema.required : []) if (!(k in (v as any))) out.push(`${path}.${k}: missing`);
    for (const [k, sub] of Object.entries<any>(schema.properties ?? {}))
      if (k in (v as any)) out.push(...schemaProblems(sub, (v as any)[k], `${path}.${k}`, depth + 1));
  }
  return out;
}

const ERROR_KEYS = ["error", "errors", "err", "message"];
const PLACEHOLDER_BODY = /lorem ipsum|\bplaceholder\b|coming soon|not (yet )?implemented|\bTODO\b|\bmock(ed)? (data|response)\b|\bdummy (data|response)\b|sample response/i;

function newestTimestamp(v: unknown, now: number, depth = 0): number | null {
  if (depth > 4 || v === null || v === undefined) return null;
  let best: number | null = null;
  const consider = (t: number | null) => {
    if (t !== null && t <= now + 3_600_000 && t > Date.UTC(2015, 0, 1)) best = best === null ? t : Math.max(best, t);
  };
  if (Array.isArray(v)) for (const x of v.slice(0, 50)) consider(newestTimestamp(x, now, depth + 1));
  else if (typeof v === "object")
    for (const [k, x] of Object.entries(v as any)) {
      if (/time|date|updated|_at$|^ts$|timestamp|as_?of|last/i.test(k)) {
        if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)) consider(Date.parse(x));
        else if (typeof x === "number") consider(x > 1e12 ? x : x * 1000);
      }
      if (x && typeof x === "object") consider(newestTimestamp(x, now, depth + 1));
    }
  return best;
}

/** How fresh the description promises the data to be, in ms; null when it says nothing measurable. */
export function promisedFreshness(description: string | null | undefined): { ms: number; said: string } | null {
  const d = (description ?? "").toLowerCase();
  const every = d.match(/every (\d+)\s*(second|sec|minute|min|hour)s?/);
  if (every) {
    const n = Number(every[1]) * (every[2].startsWith("h") ? 3_600_000 : every[2].startsWith("m") ? 60_000 : 1000);
    return { ms: Math.max(n * 3, 3_600_000), said: every[0] };
  }
  // "current" alone is not a frequency (a daily index is "current" too), so it promises nothing measurable.
  const m = d.match(/real[- ]?time|\blive\b|\blatest\b|up[- ]to[- ]the[- ]minute/);
  if (m) return { ms: 6 * 3_600_000, said: m[0] };
  if (/\bhourly\b/.test(d)) return { ms: 6 * 3_600_000, said: "hourly" };
  if (/\bdaily\b/.test(d)) return { ms: 3 * 86_400_000, said: "daily" };
  return null;
}

/** Which kind of payload the description/definition implies. */
function expectedKind(description: string | null | undefined, outputType: string | null | undefined): "audio" | "image" | "json" | null {
  const d = (description ?? "").toLowerCase();
  if (/\b(tts|text[- ]to[- ]speech|audio|mp3|speech synthesis)\b/.test(d) && !/speech[- ]to[- ]text|transcri/.test(d)) return "audio";
  if (/\b(generate|create)s? (an? )?images?\b|\bimage generation\b|\bpng\b/.test(d)) return "image";
  if (outputType === "json") return "json";
  return null;
}

// Inputs a correct answer names back. A chain/network is a setting (a block number need not
// repeat "ethereum"), so it is not expected in the output (from 2026-11-08, also when re-read).
// A username is not expected either: posts carry an author id, not the handle asked for.
/** A JSON key that carries media: audio, audio_base64, b64_json, image_url, url, base64 ... */
const MEDIA_KEY = /"[a-z0-9_]*(audio|image|b64|base64|url)[a-z0-9_]*"\s*:/;

const REFLECT_NAME = /^(symbol|ticker|address|wallet|token_?address|contract|city|location|pair|coin|coin_?id|ids?|domain|url)$/i;
const SETTING_ONLY = /^none of ((chain|network|username|handle)=[^,]+(, )?)+ appears in the output$/;

/**
 * The five checks on a delivered body. `values` are the request's inputs (with where they came
 * from); only identifier-like inputs are expected back in the output.
 */
export function contentChecks(a: {
  body: Buffer; contentType: string | null; description: string | null;
  output: { type: string | null; example: unknown; schema: any } | null;
  values: { name: string; value: unknown }[]; now?: Date;
}): Check[] {
  const now = (a.now ?? new Date()).getTime();
  const text = a.body.toString("utf8");
  const json = tryJson(text);
  const checks: Check[] = [];

  // 1. output schema: required fields and types
  const schema = a.output?.schema;
  if (schema && (schema.required?.length || schema.properties)) {
    if (json === undefined) checks.push({ name: "output_schema", result: "fail", detail: "the schema describes JSON; the body is not JSON" });
    else {
      const p = schemaProblems(schema, json);
      checks.push(p.length ? { name: "output_schema", result: "fail", detail: p.slice(0, 5).join("; ") } : { name: "output_schema", result: "pass", detail: "required fields and types match" });
    }
  } else checks.push({ name: "output_schema", result: "not_checked", detail: "no output schema published" });

  // 2. not empty, not an error, not a placeholder
  const trimmed = text.trim();
  let empty: string | null = null;
  if (!trimmed) empty = "empty body";
  else if (json !== undefined && (json === null || (typeof json === "object" && Object.keys(json as object).length === 0))) empty = "empty JSON";
  else if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    const keys = Object.keys(o);
    if (o.success === false || o.ok === false) empty = `success: false (${String(o.error ?? o.message ?? "").slice(0, 80)})`;
    else if (keys.length <= 3 && keys.some((k) => ERROR_KEYS.includes(k)) && (o.error || o.errors) ) empty = `error object: ${JSON.stringify(o).slice(0, 120)}`;
  }
  if (!empty && PLACEHOLDER_BODY.test(trimmed.slice(0, 5000))) empty = `placeholder text: "${trimmed.match(PLACEHOLDER_BODY)![0]}"`;
  // Only when the request carried inputs: a call without inputs (a ping, a static list) may well answer its example.
  if (!empty && a.values.length && a.output?.example && json !== undefined && JSON.stringify(json) === JSON.stringify(a.output.example)) empty = "the body is the published example, verbatim";
  checks.push(empty ? { name: "not_empty", result: "fail", detail: empty } : { name: "not_empty", result: "pass", detail: `${a.body.length} bytes` });

  // 3. input reflected in the output
  const ids = a.values.filter((v) => REFLECT_NAME.test(v.name) && (typeof v.value === "string" || typeof v.value === "number") && String(v.value).length >= 2);
  if (!ids.length) checks.push({ name: "input_reflected", result: "not_checked", detail: "no identifier-like input to look for" });
  else {
    const hay = text.toLowerCase();
    const variants = (s: string) => {
      const l = s.toLowerCase();
      return [l, l.replace(/^https?:\/\//, "").replace(/\/$/, ""), ...l.split(/[-/_,]/).filter((x) => x.length >= 3)];
    };
    const missing = ids.filter((v) => !variants(String(v.value)).some((x) => hay.includes(x)));
    checks.push(missing.length === ids.length
      ? { name: "input_reflected", result: "fail", detail: `none of ${ids.map((v) => `${v.name}=${v.value}`).join(", ")} appears in the output` }
      : { name: "input_reflected", result: "pass", detail: `${ids.filter((v) => !missing.includes(v)).map((v) => v.name).join(", ")} found in the output` });
  }

  // 4. freshness against the described update frequency
  const promise = promisedFreshness(a.description);
  if (!promise) checks.push({ name: "freshness", result: "not_checked", detail: "the description states no update frequency" });
  else {
    const t = json === undefined ? null : newestTimestamp(json, now);
    if (t === null) checks.push({ name: "freshness", result: "not_checked", detail: `"${promise.said}" promised; no timestamp in the output` });
    else {
      const age = now - t;
      checks.push(age > promise.ms
        ? { name: "freshness", result: "fail", detail: `"${promise.said}" promised; newest timestamp ${new Date(t).toISOString()} is ${Math.round(age / 3_600_000)}h old` }
        : { name: "freshness", result: "pass", detail: `newest timestamp ${new Date(t).toISOString()}` });
    }
  }

  // 5. kind of data matches the description
  const kind = expectedKind(a.description, a.output?.type);
  const ct = (a.contentType ?? "").toLowerCase();
  if (!kind) checks.push({ name: "data_kind", result: "not_checked", detail: "no data kind stated" });
  else if (kind === "json") checks.push(json !== undefined ? { name: "data_kind", result: "pass", detail: "JSON as described" } : { name: "data_kind", result: "fail", detail: `JSON described; got ${ct || "non-JSON"}` });
  else {
    const binary = ct.startsWith(`${kind}/`);
    const linked = json !== undefined && new RegExp(`(https?://\\S+\\.(${kind === "audio" ? "mp3|wav|ogg|m4a" : "png|jpe?g|webp|gif"}))|"data:${kind}/|${MEDIA_KEY.source}`, "i").test(text);
    checks.push(binary || linked ? { name: "data_kind", result: "pass", detail: binary ? ct : `${kind} referenced in JSON` } : { name: "data_kind", result: "fail", detail: `${kind} described; got ${ct || "unknown"} without ${kind}` });
  }
  return checks;
}

/** §3 category of one row (a curated purchase, or an older bare-GET purchase re-read). */
export function categorize(r: Record<string, unknown>): { category: Category; reason: string } | null {
  if (r.kind !== "paid" || r.dry_run) return null;
  const skipped = typeof r.skipped === "string" ? r.skipped : null;
  if (skipped) {
    if (skipped.startsWith("no_usage")) return { category: "no_usage", reason: skipped.replace(/^no_usage:\s*/, "") };
    if (/per-call cap/.test(skipped)) return { category: "over_price", reason: skipped };
    if (/^HTTP \d+ on [A-Z]+, not 402/.test(skipped)) return { category: "input_mismatch", reason: skipped };
    if (/^excluded/.test(skipped)) return null;
    return { category: "not_bought", reason: skipped };
  }
  const o = outcomeOf(r);
  if (o === "invalid_target" || o === null) return null;
  const status = typeof r.http_status === "number" ? r.http_status : 0;
  const failed = ((r.checks as { name: string; result: string; detail: string }[] | undefined) ?? [])
    .filter((c) => c.result === "fail")
    // rows checked before chain/network left REFLECT_NAME are read with the current rule
    .filter((c) => !(c.name === "input_reflected" && SETTING_ONLY.test(c.detail)))
    // Read with the rules as of 2026-11-08 (rows checked earlier that day are re-read, not rewritten):
    // the published example returned for a call without inputs, and the {type, example} wrapper
    // misread as the output schema, are not failures.
    .filter((c) => !(c.name === "not_empty" && /published example/.test(c.detail) && !((r.request as any)?.values ?? []).length))
    .filter((c) => !(c.name === "output_schema" && c.detail === "$.type: missing"))
    .filter((c) => !(c.name === "freshness" && /^"current" promised/.test(c.detail)))
    // data kind: media returned inside JSON under a key like "audio_base64" (rule as of 2026-11-20),
    // judged from the body head kept with the row.
    .filter((c) => !(c.name === "data_kind" && typeof r.body_head === "string" && new RegExp(MEDIA_KEY.source, "i").test(r.body_head)));
  switch (o) {
    case "delivered":
      return failed.length ? { category: "not_as_described", reason: failed.map((c) => `${c.name}: ${c.detail}`).join(" / ") } : { category: "as_described", reason: r.checks ? "all checks passed or not applicable" : "delivered (content not checked: bought before the checks existed)" };
    case "overcharged":
      return { category: "not_as_described", reason: "the transfer on chain was larger than the 402 offered" };
    case "not_delivered":
      return status >= 400 && status < 500 && status !== 402
        ? { category: "paid_then_rejected", reason: `transfer, then HTTP ${status}` }
        : { category: "paid_not_delivered", reason: status ? `transfer, then HTTP ${status}` : `transfer, then ${String(r.error ?? "no response")}` };
    case "delivered_unsettled":
      return { category: "delivered_without_payment", reason: "200 with a body; no transfer found" };
    case "request_rejected":
      // The seller read the request and refused it (4xx other than 402) before any money moved:
      // the request was short of what it needs, so it is the Probe's input, not the seller's failure.
      if (status >= 400 && status < 500 && status !== 402)
        return { category: "input_rejected_unpaid", reason: `no transfer; HTTP ${status}` };
      return { category: "not_settled", reason: status ? `no transfer; HTTP ${status}` : `no transfer; ${String(r.error ?? "no response")}` };
    case "failed":
      return { category: "not_settled", reason: status ? `no transfer; HTTP ${status}` : `no transfer; ${String(r.error ?? "no response")}` };
  }
  return null;
}
