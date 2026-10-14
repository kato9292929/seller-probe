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
