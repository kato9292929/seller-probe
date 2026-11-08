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
  no_usage: "使い方が公開されていない",
  over_price: "価格超過",
  not_bought: "買わなかった（残高・上限・対応外の支払い方法）",
} as const;
export type Category = keyof typeof CATEGORIES;

/** Definitions shown on the page, one per category. */
export const DEFINITIONS: Record<Category, string> = {
  as_described: "送金が確認でき、200 で本文が届き、中身の確認（出力の型・空や誤りでない・入力の反映・鮮度・データの種類）にひとつも外れがない。",
  not_as_described: "送金が確認でき、200 で本文が届いたが、中身の確認のどれかに外れた（外れた確認と本文の先頭500文字を記録）。送金額が 402 の提示より多かった場合もここ。",
  input_mismatch: "支払う前に同じ要求を支払いなしで送ったら 402 以外（400 など）が返った。Probe 側の入力が売り手の受け付ける形に合っていないので、払っていない。",
  paid_then_rejected: "支払いなしでは 402 を返したのに、支払うと 4xx（400・405 など）で断られ、送金だけが済んだ。要求の中身を確かめる前に決済している。",
  paid_not_delivered: "支払いなしでは 402 を返し、支払って送金が確認できたのに、5xx・タイムアウトなどで中身が届かなかった。",
  delivered_without_payment: "送金が見つからない（決済ヘッダもチェーン上にもない）のに 200 で本文が届いた。",
  not_settled: "支払いを送ったが送金は起きず（決済の失敗）、中身も届かなかった。お金は動いていない。",
  no_usage: "402 の定義・x402 Endpoint・Bazaar・売り手の llms.txt / OpenAPI / PAY.md のどこにも呼び方が無い、または必須項目の値が決められない。払っていない。",
  over_price: "402 の提示額が 1コールの上限 $0.01 を超えた。払っていない。",
  not_bought: "残高・7日の上限・USDC 以外や対応外の支払い方法のため、払っていない（その週は測っていない）。",
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
    const linked = json !== undefined && new RegExp(`(https?://\\S+\\.(${kind === "audio" ? "mp3|wav|ogg|m4a" : "png|jpe?g|webp|gif"}))|"data:${kind}/|"(audio|image|url|b64_json|base64)"\\s*:`, "i").test(text);
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
    .filter((c) => !(c.name === "freshness" && /^"current" promised/.test(c.detail)));
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
    case "failed":
      return { category: "not_settled", reason: status ? `no transfer; HTTP ${status}` : `no transfer; ${String(r.error ?? "no response")}` };
  }
  return null;
}
