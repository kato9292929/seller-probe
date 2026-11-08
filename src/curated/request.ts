// Building the request the way the seller documents it. Sources, in this order, first found wins:
//  1. the 402 itself (v2 extensions.bazaar; v1 accepts[].outputSchema.input),
//  2. x402 Endpoint /api/endpoints/:id,
//  3. the CDP Bazaar (facilitator discovery; kept in targets/curated.json),
//  4. the seller's own docs: OpenAPI, llms.txt, or a pay-skills PAY.md.
// Values: the definition's own example; otherwise a type-representative value (AAPL, Tokyo,
// the USDC contract, ...). Every value records where it came from. Pure except fetchDocs.
import { randomUUID } from "node:crypto";
import { USDC, USER_AGENT } from "../config.js";

export type FieldDef = { type?: string; required?: boolean; example?: unknown; enum?: unknown[]; default?: unknown; description?: string; pattern?: string; minimum?: number; items?: any; properties?: any };

/** One endpoint's usage, normalized from any source. */
export type Definition = {
  source: "402" | "x402_endpoint" | "bazaar" | "openapi" | "llms_txt" | "pay_md";
  source_detail: string;
  method: string;
  query: Record<string, FieldDef>;
  body: Record<string, FieldDef> | null;
  /** A complete example body/query given by the definition, used as is when present. */
  body_example: unknown;
  query_example: Record<string, unknown> | null;
  body_type: string | null;
  output: { type: string | null; example: unknown; schema: any } | null;
};

export type ValueUsed = { in: "query" | "body"; name: string; value: unknown; from: "definition example" | "schema example" | "schema default" | "enum" | "representative" | "fresh per request" };

export type BuiltRequest = {
  method: string;
  url: string; // with the query string
  query: Record<string, string>;
  body: unknown; // JSON body, or null
  content_type: string | null;
  source: Definition["source"];
  source_detail: string;
  values: ValueUsed[];
};

export type BuildResult = { ok: true; request: BuiltRequest; definition: Definition } | { ok: false; reason: string; tried: string[] };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const FIELD_KEYS = ["type", "description", "required", "enum", "example", "examples", "default", "pattern", "format"];
/** `{ name: { type, description, ... } }` (field definitions) rather than `{ name: value }` (an example). */
const looksLikeFields = (o: Record<string, unknown>) => {
  const vals = Object.values(o);
  return vals.length > 0 && vals.every((v) => isObj(v) && Object.keys(v).some((k) => FIELD_KEYS.includes(k)));
};

function fieldsFromSchema(s: any): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = {};
  const req: string[] = Array.isArray(s?.required) ? s.required : [];
  for (const [k, v] of Object.entries<any>(s?.properties ?? {})) {
    out[k] = {
      type: Array.isArray(v?.type) ? v.type.find((t: string) => t !== "null") : v?.type,
      required: req.includes(k) || v?.required === true,
      example: v?.example ?? (Array.isArray(v?.examples) ? v.examples[0] : undefined),
      enum: Array.isArray(v?.enum) ? v.enum : v?.const !== undefined ? [v.const] : undefined,
      default: v?.default, description: v?.description, pattern: v?.pattern, minimum: v?.minimum, items: v?.items, properties: v?.properties,
    };
  }
  return out;
}

function mergeFields(a: Record<string, FieldDef>, b: Record<string, FieldDef>): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const def = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
    out[k] = { ...(a[k] ?? {}), ...def, required: !!(a[k]?.required || v.required) };
  }
  return out;
}

function fieldsFromInfo(o: Record<string, any>): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = {};
  for (const [k, v] of Object.entries(o)) out[k] = { ...v, example: v.example ?? (Array.isArray(v.examples) ? v.examples[0] : undefined), required: v.required === true };
  return out;
}

/**
 * Normalize the x402/Bazaar input forms: `info.input` (method, queryParams, body/bodyFields; values
 * are examples, or field definitions) and `schema.properties.input` (JSON Schema).
 */
export function fromBazaarShape(source: Definition["source"], detail: string, input: any, inputSchema: any, output: any, outputSchema: any): Definition | null {
  if (!isObj(input) && !isObj(inputSchema)) return null;
  const sp = inputSchema?.properties ?? {};
  const methodEnum = Array.isArray(sp.method?.enum) ? sp.method.enum : typeof sp.method?.const === "string" ? [sp.method.const] : [];
  const method = String(input?.method ?? methodEnum[0] ?? "GET").toUpperCase();
  let query: Record<string, FieldDef> = {};
  let query_example: Record<string, unknown> | null = null;
  const qp = input?.queryParams;
  if (isObj(qp) && Object.keys(qp).length) {
    if (looksLikeFields(qp)) query = fieldsFromInfo(qp);
    else query_example = qp;
  }
  if (sp.queryParams?.properties) query = mergeFields(fieldsFromSchema(sp.queryParams), query);
  let body: Record<string, FieldDef> | null = null;
  let body_example: unknown = null;
  if (isObj(input?.bodyFields) && Object.keys(input.bodyFields).length) body = fieldsFromInfo(input.bodyFields);
  if (input?.body !== undefined && input?.body !== null && !(isObj(input.body) && !Object.keys(input.body).length)) {
    if (isObj(input.body) && looksLikeFields(input.body) && !body) body = fieldsFromInfo(input.body);
    else body_example = input.body;
  }
  if (sp.body?.properties) body = mergeFields(fieldsFromSchema(sp.body), body ?? {});
  const exSchema = outputSchema?.properties?.example ?? (outputSchema?.type && outputSchema?.properties && !outputSchema.properties.example ? outputSchema : null);
  return {
    source, source_detail: detail, method, query, body, body_example, query_example,
    body_type: input?.bodyType ?? (body || body_example !== null ? "json" : null),
    output: output || exSchema ? { type: output?.type ?? null, example: output?.example ?? null, schema: exSchema } : null,
  };
}

/** A usable definition from the 402 document (v2 bazaar extension, or a v1 accept's outputSchema). */
export function fromPaymentRequired(doc: any): Definition | null {
  const bz = doc?.extensions?.bazaar;
  if (bz) {
    const d = fromBazaarShape("402", "PAYMENT-REQUIRED extensions.bazaar", bz.info?.input, bz.schema?.properties?.input, bz.info?.output, bz.schema?.properties?.output);
    if (d && hasUsage(d)) return d;
  }
  for (const a of doc?.accepts ?? []) {
    const os = a?.outputSchema;
    if (!os?.input) continue;
    const schemaForm = os.input?.type === "object" && os.input?.properties;
    const d = fromBazaarShape("402", "accepts[].outputSchema", schemaForm ? null : os.input, schemaForm ? os.input : null, os.output && !os.output.properties ? { example: os.output } : null, os.output?.properties ? os.output : null);
    if (d && hasUsage(d)) return d;
  }
  return null;
}

/** Says something about how to call it: a method plus parameters, or an explicit no-parameter GET. */
export function hasUsage(d: Definition): boolean {
  const bodyKnown = (d.body !== null && Object.keys(d.body).length > 0) || (d.body_example !== null && !(isObj(d.body_example) && !Object.keys(d.body_example).length));
  if (["POST", "PUT", "PATCH"].includes(d.method)) return bodyKnown;
  return true;
}

/** OpenAPI 3 / Swagger 2: the operation for this URL's path. */
export function fromOpenApi(spec: any, url: string, detail: string): Definition | null {
  if (!isObj(spec?.paths)) return null;
  const u = new URL(url);
  const prefixes = [""];
  for (const s of spec.servers ?? []) {
    try {
      prefixes.push(new URL(s.url, url).pathname.replace(/\/$/, ""));
    } catch {
      /* ignore */
    }
  }
  if (spec.basePath) prefixes.push(String(spec.basePath).replace(/\/$/, ""));
  let op: any = null;
  let method = "";
  for (const pre of prefixes) {
    const path = u.pathname.startsWith(pre) ? u.pathname.slice(pre.length) || "/" : null;
    const item = path ? spec.paths[path] : null;
    if (!item) continue;
    for (const m of ["get", "post", "put", "patch"]) if (item[m]) { op = item[m]; method = m.toUpperCase(); break; }
    if (op) break;
  }
  if (!op) return null;
  const query: Record<string, FieldDef> = {};
  for (const p of op.parameters ?? []) {
    const prm = p.$ref ? resolveRef(spec, p.$ref) : p;
    if (prm?.in !== "query") continue;
    const sch = prm.schema ?? prm;
    query[prm.name] = { type: sch.type, required: !!prm.required, example: prm.example ?? sch.example ?? (prm.examples ? Object.values<any>(prm.examples)[0]?.value : undefined), enum: sch.enum, default: sch.default, description: prm.description, pattern: sch.pattern, minimum: sch.minimum };
  }
  let body: Record<string, FieldDef> | null = null;
  let body_example: unknown = null;
  const rb = op.requestBody?.$ref ? resolveRef(spec, op.requestBody.$ref) : op.requestBody;
  const media = rb?.content?.["application/json"];
  if (media) {
    body_example = media.example ?? (media.examples ? Object.values<any>(media.examples)[0]?.value : null) ?? null;
    const sch = media.schema?.$ref ? resolveRef(spec, media.schema.$ref) : media.schema;
    body = sch ? fieldsFromSchema(sch) : {};
    if (sch?.example && body_example === null) body_example = sch.example;
  }
  const resp = op.responses?.["200"]?.content?.["application/json"];
  const rs = resp?.schema?.$ref ? resolveRef(spec, resp.schema.$ref) : resp?.schema;
  return { source: "openapi", source_detail: detail, method, query, body, body_example, query_example: null, body_type: media ? "json" : null, output: resp ? { type: "json", example: resp.example ?? null, schema: rs ?? null } : null };
}

function resolveRef(spec: any, ref: string): any {
  if (!ref.startsWith("#/")) return null;
  return ref.slice(2).split("/").reduce((o, k) => o?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
}

/**
 * llms.txt / PAY.md: an example call for this exact path written in the text (a curl line or a
 * URL with a query string, with a JSON body following -d). Nothing is guessed from prose.
 */
export function fromText(text: string, url: string, source: "llms_txt" | "pay_md", detail: string): Definition | null {
  const u = new URL(url);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(new RegExp(`(https?://[^\\s'"\`]*)?${esc(u.pathname)}(\\?[^\\s'"\`]*)?(?=[\\s'"\`]|$)`));
    if (!m || (m[1] && !m[1].includes(u.host))) continue;
    // The root path matches nearly any line: only a full URL naming this host counts there.
    if (u.pathname === "/" && !m[1]) continue;
    const isCurl = /\bcurl\b/.test(line) || /\bcurl\b/.test(lines[i - 1] ?? "");
    const block = lines.slice(i, i + 12).join("\n");
    const method = (block.match(/-X\s+([A-Z]+)/)?.[1] ?? (/(\s-d\s|--data)/.test(block) ? "POST" : /^\s*(GET|POST|PUT|PATCH)\b/.exec(line)?.[1] ?? "GET")).toUpperCase();
    const q = m[2] ? Object.fromEntries(new URLSearchParams(m[2].slice(1))) : null;
    let body_example: unknown = null;
    const d = block.match(/(?:-d|--data(?:-raw)?)\s+'([\s\S]*?)'/);
    if (d) {
      try {
        body_example = JSON.parse(d[1]);
      } catch {
        /* not JSON */
      }
    }
    if (!q && body_example === null && !isCurl && method === "GET" && !m[0].includes("://")) continue;
    return { source, source_detail: detail, method, query: {}, body: method === "GET" ? null : {}, body_example, query_example: q, body_type: body_example !== null ? "json" : null, output: null };
  }
  return null;
}

// ---- values

const PLACEHOLDER = /^(example[_-]|your[_-]|<.*>$|\{.*\}$|xxx|(string|number|integer|boolean|array|object)$|placeholder|todo|\.\.\.$|0x\.\.\.)/i;
export const isPlaceholder = (v: unknown) => typeof v === "string" && PLACEHOLDER.test(v.trim());

/** An example the field's own description gives: "e.g. X", "如 X", "例: X", "?name=X", "X (default)". */
export function exampleFromDescription(name: string, description: string | undefined): string | null {
  if (!description) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pats = [
    new RegExp(`[?&]${esc}=([^&\\s)，,；;]+)`),
    /\be\.g\.?,?\s*[:：]?\s*["'`]?([A-Za-z0-9][\w./:@-]*)/i,
    /(?:如|例如|例)\s*[:：]?\s*["'`]?([A-Za-z0-9][\w./:@-]*)/,
    /\bexample\s*[:：]\s*["'`]?([A-Za-z0-9][\w./:@-]*)/i,
    /([A-Za-z0-9][\w./-]*)\s*\(default\)/i,
  ];
  for (const p of pats) {
    const m = description.match(p);
    if (m) return m[1].replace(/[.,;)]+$/, "");
  }
  return null;
}

/** A representative value for a field nobody gave an example for; null when none fits. */
export function representative(name: string, f: FieldDef, ctx: { description?: string | null; today: string }): unknown {
  const n = name.toLowerCase();
  const desc = `${f.description ?? ""} ${ctx.description ?? ""}`.toLowerCase();
  const crypto = /crypto|token|coin|defi|solana|base|ethereum|onchain|wallet|dex/.test(desc);
  const sol = /solana|\bspl\b|\bsol\b/.test(desc) && !/\bbase\b|evm|ethereum/.test(desc);
  if (f.pattern?.includes("0x[0-9a-fA-F]{40}") || /(^|_)(address|wallet|contract|token_?address|mint)$/.test(n) || /address$/.test(n)) return sol ? USDC.solana : USDC.base;
  if (/^(symbol|ticker|tickers|symbols|stock)$/.test(n)) return crypto ? "BTC" : "AAPL";
  if (/^(coin|coin_?id|asset|base)$/.test(n)) return crypto ? "bitcoin" : "AAPL";
  if (/^(pair|market)$/.test(n)) return "BTC-USD";
  if (/^(city|location|place|destination|origin|region|address_?text)$/.test(n)) return "Tokyo";
  if (/^(country|country_?code)$/.test(n)) return "JP";
  if (/^(token|token_?id)$/.test(n) && /address|contract|mint/.test((f.description ?? "").toLowerCase())) return sol ? USDC.solana : USDC.base;
  if (/^(amount|value|qty|quantity)$/.test(n)) return f.type === "string" ? "100" : 100;
  if (/^(chain|network|blockchain)$/.test(n)) return sol ? "solana" : "base";
  if (/^(url|link|website|page_?url|target_?url)$/.test(n)) return "https://example.com";
  if (/^(domain|host)$/.test(n)) return "example.com";
  if (/^(email)$/.test(n)) return "test@example.com";
  if (/^(q|query|search|keyword|keywords|topic|text|prompt|question|input|term)$/.test(n)) return crypto ? "bitcoin" : "Tokyo weather";
  if (/^(lang|language|locale)$/.test(n)) return "en";
  if (/^(currency|from|base_?currency)$/.test(n)) return "USD";
  if (/^(to|quote_?currency|target_?currency)$/.test(n)) return "JPY";
  if (/(date|day)$/.test(n)) return ctx.today;
  if (/^(limit|count|num_?results|size|page_?size|top|n|max_?results)$/.test(n)) return 1;
  if (/^(page|offset)$/.test(n)) return n === "offset" ? 0 : 1;
  if (/^(messages)$/.test(n)) return [{ role: "user", content: "Reply with the single word: hello" }];
  if (/^(max_?tokens)$/.test(n)) return 16;
  if (/^(username|handle|user|screen_?name)$/.test(n)) return "x402";
  if (f.type === "boolean") return false;
  if (f.type === "integer" || f.type === "number") return f.minimum ?? 1;
  return null;
}

const PRIMARY = /^(q|query|search|url|urls|text|prompt|question|input|address|symbol|ticker|messages)$/i;

/** Idempotency keys and nonces are made fresh: reusing a documented example could collide with the seller's own. */
const FRESH = /idempot|request_?key|nonce|request_?id|client_?ref/i;

function pick(name: string, f: FieldDef, where: "query" | "body", ctx: { description?: string | null; today: string }, used: ValueUsed[]): unknown {
  if (FRESH.test(name)) {
    const v = `probe-${randomUUID()}`;
    used.push({ in: where, name, value: v, from: "fresh per request" });
    return v;
  }
  const cands: [unknown, ValueUsed["from"]][] = [[f.example, "schema example"], [f.default, "schema default"], [f.enum?.[0], "enum"], [exampleFromDescription(name, f.description), "schema example"]];
  for (const [v, from] of cands)
    if (v !== undefined && v !== null && !isPlaceholder(v)) {
      used.push({ in: where, name, value: v, from });
      return v;
    }
  const r = representative(name, f, ctx);
  if (r !== null) used.push({ in: where, name, value: r, from: "representative" });
  return r;
}

/** Fill the definition into a concrete request; fails when a required field has no value. */
export function fill(d: Definition, url: string, ctx: { description?: string | null; today: string }): { ok: true; request: BuiltRequest } | { ok: false; reason: string } {
  const used: ValueUsed[] = [];
  const query: Record<string, string> = {};
  const base = new URL(url);
  for (const [k, v] of base.searchParams) query[k] = v;
  if (d.query_example) {
    for (const [k, v] of Object.entries(d.query_example)) {
      const f = d.query[k] ?? {};
      if (isPlaceholder(v) && d.query[k] && !f.required) continue; // optional and only a type name: left out
      const val = isPlaceholder(v) || FRESH.test(k) ? pick(k, { ...f, example: undefined }, "query", ctx, used) : (used.push({ in: "query", name: k, value: v, from: "definition example" }), v);
      if (val === null || val === undefined) return { ok: false, reason: `query ${k}: example is a placeholder and no representative value fits` };
      query[k] = String(val);
    }
  }
  for (const [k, f] of Object.entries(d.query)) {
    if (k in query || !f.required) continue;
    const v = pick(k, f, "query", ctx, used);
    if (v === null || v === undefined) return { ok: false, reason: `required query ${k} (${f.type ?? "?"}) has no example and no representative value` };
    query[k] = Array.isArray(v) ? v.join(",") : String(v);
  }
  let body: unknown = null;
  if (d.body_example !== null && d.body_example !== undefined) {
    if (isObj(d.body_example)) {
      const b: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d.body_example)) {
        if (isPlaceholder(v) || FRESH.test(k)) {
          const val = pick(k, { ...(d.body?.[k] ?? {}), example: undefined }, "body", ctx, used);
          if (val === null || val === undefined) return { ok: false, reason: `body ${k}: example is a placeholder and no representative value fits` };
          b[k] = val;
        } else {
          b[k] = v;
          used.push({ in: "body", name: k, value: v, from: "definition example" });
        }
      }
      for (const [k, f] of Object.entries(d.body ?? {})) {
        if (k in b || !f.required) continue;
        const v = pick(k, f, "body", ctx, used);
        if (v === null || v === undefined) return { ok: false, reason: `required body ${k} has no value` };
        b[k] = v;
      }
      body = b;
    } else {
      body = d.body_example;
      used.push({ in: "body", name: "(whole body)", value: d.body_example, from: "definition example" });
    }
  } else if (d.body) {
    const b: Record<string, unknown> = {};
    // chat-completions shape: messages is required in practice even when not marked
    let needs = Object.entries(d.body).filter(([k, f]) => f.required || (k === "messages" && "messages" in d.body!) || (k === "model" && "messages" in d.body!));
    // Nothing marked required: send the field(s) the call is about (query, url, text, ...).
    if (!needs.length) needs = Object.entries(d.body).filter(([k]) => PRIMARY.test(k)).slice(0, 2);
    for (const [k, f] of needs) {
      const v = pick(k, f, "body", ctx, used);
      if (v === null || v === undefined) return { ok: false, reason: `required body ${k} (${f.type ?? "?"}) has no example and no representative value` };
      b[k] = v;
    }
    body = ["POST", "PUT", "PATCH"].includes(d.method) ? b : null;
  }
  const full = new URL(url);
  full.search = new URLSearchParams(query).toString();
  return {
    ok: true,
    request: {
      method: d.method, url: full.toString(), query, body, content_type: body !== null ? "application/json" : null,
      source: d.source, source_detail: d.source_detail, values: used,
    },
  };
}

/** Pure: first source with a usable definition wins; the result says which and what was used. */
export function buildRequest(
  url: string,
  sources: { from402: Definition | null; x402Endpoint: Definition | null; bazaar: Definition | null; docs: Definition | null },
  ctx: { description?: string | null; today: string },
): BuildResult {
  const tried: string[] = [];
  for (const [label, d] of [["402", sources.from402], ["x402 Endpoint", sources.x402Endpoint], ["Bazaar", sources.bazaar], ["docs", sources.docs]] as const) {
    if (!d) {
      tried.push(`${label}: no definition`);
      continue;
    }
    if (!hasUsage(d)) {
      tried.push(`${label}: ${d.method} with no body definition or example`);
      continue;
    }
    const f = fill(d, url, ctx);
    if (f.ok) return { ok: true, request: f.request, definition: d };
    tried.push(`${label}: ${f.reason}`);
  }
  return { ok: false, reason: "使い方が公開されていない", tried };
}

/** The seller's own docs: OpenAPI, then llms.txt, then the pay-skills PAY.md the x402 Endpoint links. */
export async function fetchDocs(url: string, paySkillsUrl: string | null): Promise<{ def: Definition | null; tried: string[] }> {
  const u = new URL(url);
  const tried: string[] = [];
  const get = async (p: string) => {
    try {
      const r = await fetch(p, { headers: { "user-agent": USER_AGENT, accept: "application/json, text/plain, */*" }, signal: AbortSignal.timeout(10_000), redirect: "follow" });
      tried.push(`${p}: ${r.status}`);
      if (!r.ok) return null;
      const t = await r.text();
      return t.length > 5_000_000 ? null : t;
    } catch (e) {
      tried.push(`${p}: ${(e as Error).message.slice(0, 60)}`);
      return null;
    }
  };
  for (const p of ["/openapi.json", "/.well-known/openapi.json", "/api/openapi.json", "/swagger.json"]) {
    const t = await get(`${u.origin}${p}`);
    if (!t) continue;
    try {
      const d = fromOpenApi(JSON.parse(t), url, `${u.origin}${p}`);
      if (d) return { def: d, tried };
    } catch {
      /* not JSON */
    }
  }
  for (const p of ["/llms.txt", "/llms-full.txt"]) {
    const t = await get(`${u.origin}${p}`);
    const d = t ? fromText(t, url, "llms_txt", `${u.origin}${p}`) : null;
    if (d) return { def: d, tried };
  }
  if (paySkillsUrl) {
    // github.com/<o>/<r>/blob/<ref>/<path> → raw
    const raw = paySkillsUrl.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\//, "https://raw.githubusercontent.com/$1/$2/");
    const t = await get(raw.endsWith(".md") ? raw : `${raw.replace(/\/$/, "")}/PAY.md`);
    const d = t ? fromText(t, url, "pay_md", raw) : null;
    if (d) return { def: d, tried };
  }
  return { def: null, tried };
}
