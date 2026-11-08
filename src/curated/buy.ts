// One curated purchase: find how the endpoint is meant to be called, build that request, confirm
// that the same request unpaid answers 402, pay once, then check what came back (§2–§3).
import { USER_AGENT } from "../config.js";
import { errMsg, timedRequest } from "../http.js";
import { type PaidRun, probePaid, toRecord } from "../probe-paid.js";
import { parse402 } from "../x402.js";
import type { CuratedItem } from "./curate.js";
import { type Check, categorize, contentChecks } from "./judge.js";
import { type BuiltRequest, type Definition, buildRequest, fetchDocs, fromBazaarShape, fromPaymentRequired } from "./request.js";
import { ENDPOINT_SITE } from "./sources.js";

type Ctx = Omit<Parameters<typeof probePaid>[1], "request" | "extra">;

/** x402 Endpoint's entry for this endpoint: an input definition when it carries one, and the docs link. */
async function x402EndpointEntry(id: string | null): Promise<{ def: Definition | null; source_url: string | null; note: string }> {
  if (!id) return { def: null, source_url: null, note: "not in the x402 Endpoint catalog" };
  try {
    const r = await fetch(`${ENDPOINT_SITE}/api/endpoints/${encodeURIComponent(id)}`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { def: null, source_url: null, note: `HTTP ${r.status}` };
    const e: any = await r.json();
    const input = e.input ?? e.request ?? e.params ?? null;
    const def = input ? fromBazaarShape("x402_endpoint", `${ENDPOINT_SITE}/api/endpoints/${id}`, input, null, e.output ?? null, null) : null;
    return { def, source_url: typeof e.source_url === "string" ? e.source_url : null, note: def ? "input definition" : "no input definition in the entry" };
  } catch (e) {
    return { def: null, source_url: null, note: errMsg(e) };
  }
}

export type CuratedRecord = ReturnType<typeof toRecord> & {
  pick: "curated"; curated_id: string; operator: string; operator_name: string;
  request: (Omit<BuiltRequest, "values"> & { values: BuiltRequest["values"] }) | null;
  request_tried: string[];
  checks: Check[] | null;
  /** First 500 characters of the body, kept when a check failed. */
  body_head: string | null;
  category: string | null;
  category_reason: string | null;
};

export async function buyCurated(item: CuratedItem, ctx: Ctx, today: string): Promise<CuratedRecord> {
  const tried: string[] = [];
  const base = { pick: "curated" as const, curated_id: item.id, operator: item.operator, operator_name: item.operator_name };
  const bazaarDef = item.bazaar ? fromBazaarShape("bazaar", "CDP Bazaar (facilitator discovery)", item.bazaar.input, item.bazaar.inputSchema, item.bazaar.output, item.bazaar.outputSchema) : null;

  // 1. the 402 itself: ask once, unpaid, the way the best-known definition says (no parameters).
  let from402: Definition | null = null;
  try {
    const r = await timedRequest({ method: bazaarDef?.method ?? "GET", url: item.url, body: bazaarDef && bazaarDef.method !== "GET" ? {} : undefined });
    if (r.res.status === 402) {
      const doc = parse402((n) => r.res.headers.get(n), r.body.toString("utf8")).raw;
      from402 = fromPaymentRequired(doc);
      tried.push(`402: ${from402 ? from402.source_detail : "402 without an input definition"}`);
    } else tried.push(`402: HTTP ${r.res.status} without parameters`);
  } catch (e) {
    tried.push(`402: ${errMsg(e)}`);
  }
  // 2. x402 Endpoint, 3. Bazaar (kept in curated.json), 4. the seller's docs (only if 1–3 had nothing).
  const xe = await x402EndpointEntry(item.x402_endpoint_id);
  tried.push(`x402 Endpoint: ${xe.note}`);
  let docs: Definition | null = null;
  if (!from402 && !xe.def && !bazaarDef) {
    const d = await fetchDocs(item.url, xe.source_url && /pay-skills|PAY\.md/i.test(xe.source_url) ? xe.source_url : null);
    docs = d.def;
    tried.push(`docs: ${d.def ? d.def.source_detail : d.tried.join(", ") || "none"}`);
  }
  const built = buildRequest(item.url, { from402, x402Endpoint: xe.def, bazaar: bazaarDef, docs }, { description: item.description, today });
  if (!built.ok) {
    const rec: any = {
      kind: "paid", host: item.host, url: item.url, skipped: `no_usage: ${built.tried.join(" | ")}`, ...base,
      request: null, request_tried: [...tried, ...built.tried], checks: null, body_head: null,
    };
    const c = categorize(rec);
    return { ...rec, category: c?.category ?? null, category_reason: c?.reason ?? null };
  }
  const req = built.request;

  // 5–6. the same request unpaid must answer 402 (inside probePaid), then one payment.
  const run: PaidRun = await probePaid(
    { host: item.host, url: req.url, endpoint_id: item.id, price_usd: item.price_usd ?? 0, networks: [] } as any,
    { ...ctx, request: { method: req.method, url: req.url, body: req.body, content_type: req.content_type }, extra: { pick: "curated", curated_id: item.id } },
  );
  let checks: Check[] | null = null;
  let body_head: string | null = null;
  if (run.http_status === 200 && run._body && run._body.length) {
    checks = contentChecks({
      body: run._body, contentType: run.response_content_type ?? null, description: item.description, output: built.definition.output ?? bazaarDef?.output ?? null,
      values: req.values.map((v) => ({ name: v.name, value: v.value })),
    });
    if (checks.some((c) => c.result === "fail")) body_head = run._body.toString("utf8").slice(0, 500);
  }
  const rec: any = { ...toRecord(run), ...base, request: req, request_tried: tried, checks, body_head };
  const c = categorize(rec);
  return { ...rec, category: c?.category ?? null, category_reason: c?.reason ?? null };
}
