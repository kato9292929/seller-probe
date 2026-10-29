// Sellers whose own answer to a paid request showed that a bare GET cannot buy them.
// Only structured fields count — never free-text wording:
//   - a JSON error body with a `missing` list, or an error code (`error_code` / `code`) from
//     MISSING_CODES, optionally with the `parameter` it names;
//   - the 402 `error` field stating the method to use ("use POST …");
//   - HTTP 405 to the paid GET (the route takes another method) → input (observed);
//   - HTTP 401 to the paid GET → a separate reason, auth (observed): the seller wants a
//     credential besides the payment.
// Not used: 404 (a wrong route is not evidence of a required input) and free-text wording.
// The body is stored truncated (300 chars), so fields are read by key, not by JSON.parse.
import { classifyPaid } from "./outcome.js";
import type { LogRecord } from "./log.js";

/** How long an observed requirement keeps a host out before it is measured again. */
export const OBSERVED_TTL_DAYS = 28;

const MISSING_CODES = new Set([
  "missing_fields", "missing_field", "missing_parameter", "missing_parameters", "missing_param", "missing_params",
  "missing_required_fields", "missing_required_field", "missing_required_parameter", "missing_required_parameters",
  "missing_query_params", "missing_query_param", "invalid_input",
]);

const strings = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

/** `input`: a bare GET lacks a required input; `auth`: the seller wants a credential besides payment. */
export type Observation = { kind: "input" | "auth"; reason: string; evidence: { observed_at: string; http_status: number | null; error: string | null } };

export function observedInputRequirement(r: Record<string, unknown>): Observation | null {
  if (classifyPaid(r) !== "request_rejected") return null;
  const evidence = {
    observed_at: String(r.ts),
    http_status: typeof r.http_status === "number" ? r.http_status : null,
    error: (r.x402_error ?? r.error_body ?? null) as string | null,
  };
  if (evidence.http_status === 401) return { kind: "auth", reason: "HTTP 401", evidence };
  if (evidence.http_status === 405) return { kind: "input", reason: "method (HTTP 405 to GET)", evidence };
  const x = typeof r.x402_error === "string" ? r.x402_error : "";
  const m = x.match(/\buse\s+(POST|PUT|PATCH)\b/i);
  if (m) return { kind: "input", reason: `method ${m[1].toUpperCase()} (402 error)`, evidence: { ...evidence, error: x } };

  const body = typeof r.error_body === "string" ? r.error_body : "";
  if (!body.trim().startsWith("{")) return null;
  const missing = body.match(/"(?:missing|missing_fields|missing_params)"\s*:\s*\[([^\]]*)\]/);
  if (missing) {
    const names = strings(missing[1]).filter(Boolean);
    if (names.length) return { kind: "input", reason: `missing: ${names.join(", ")}`, evidence: { ...evidence, error: body } };
  }
  const code = [...body.matchAll(/"(?:error_code|code)"\s*:\s*"([A-Za-z_]+)"/g)].map((c) => c[1]).find((c) => MISSING_CODES.has(c.toLowerCase()));
  if (code) {
    const param = body.match(/"(?:parameter|param|field)"\s*:\s*"([^"]+)"/)?.[1];
    return { kind: "input", reason: `code ${code}${param ? `: ${param}` : ""}`, evidence: { ...evidence, error: body } };
  }
  return null;
}

/**
 * Per host, the observed requirement from its latest paid purchase attempt, if that attempt
 * is within OBSERVED_TTL_DAYS. A later successful purchase, or the TTL running out, lets the
 * host back in as a candidate so it is measured again.
 */
export function observedRequirements(records: LogRecord[], now = new Date()): Map<string, Observation & { until: string }> {
  const cutoff = now.getTime() - OBSERVED_TTL_DAYS * 86_400_000;
  const latest = new Map<string, LogRecord>();
  for (const r of records) {
    if (r.kind !== "paid" || r.skipped || r.dry_run) continue;
    const cur = latest.get(r.host);
    if (!cur || r.ts > cur.ts) latest.set(r.host, r);
  }
  const out = new Map<string, Observation & { until: string }>();
  for (const [host, r] of latest) {
    if (Date.parse(r.ts) < cutoff) continue;
    const o = observedInputRequirement(r);
    if (o) out.set(host, { ...o, until: new Date(Date.parse(r.ts) + OBSERVED_TTL_DAYS * 86_400_000).toISOString() });
  }
  return out;
}
