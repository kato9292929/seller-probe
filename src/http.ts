import { TIMEOUT_MS, USER_AGENT } from "./config.js";

export type Timed = { res: Response; body: Buffer; headers_ms: number; total_ms: number };

/** GET with the probe's UA and a hard timeout; times both first byte (headers) and full body. */
export async function timedGet(url: string, headers: Record<string, string> = {}, timeoutMs = TIMEOUT_MS, method: "GET" | "POST" = "GET"): Promise<Timed> {
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers: { "user-agent": USER_AGENT, accept: "application/json, */*", ...(method === "POST" ? { "content-type": "application/json" } : {}), ...headers },
    body: method === "POST" ? "{}" : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  const headers_ms = Math.round(performance.now() - t0);
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body, headers_ms, total_ms: Math.round(performance.now() - t0) };
}

export const errMsg = (e: any) => (e?.name === "TimeoutError" ? "timeout" : `${e?.message ?? e}${e?.cause?.code ? ` (${e.cause.code})` : ""}`);

/** First 300 characters of a response body, whitespace collapsed (for failure records; headers are never logged). */
export function bodySnippet(body: Buffer | string, max = 300): string | null {
  const t = (typeof body === "string" ? body : body.toString("utf8")).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** A request as documented (any method, query already in the URL, JSON body), with the probe's UA. */
export async function timedRequest(
  req: { method: string; url: string; body?: unknown; content_type?: string | null },
  headers: Record<string, string> = {},
  timeoutMs = TIMEOUT_MS,
): Promise<Timed> {
  const t0 = performance.now();
  const hasBody = req.body !== null && req.body !== undefined && !["GET", "HEAD"].includes(req.method);
  const res = await fetch(req.url, {
    method: req.method,
    headers: { "user-agent": USER_AGENT, accept: "application/json, */*", ...(hasBody ? { "content-type": req.content_type ?? "application/json" } : {}), ...headers },
    body: hasBody ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  const headers_ms = Math.round(performance.now() - t0);
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body, headers_ms, total_ms: Math.round(performance.now() - t0) };
}
