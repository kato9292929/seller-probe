// A web-standard (Request → Response) x402 paywall for the Probe's own paid API (POST /monitor),
// in the shape of @x402/next's withX402: unpaid → 402 challenge; paid → verify, run the handler,
// settle only if the handler succeeded. Settled by the PayAI facilitator on Solana and Base.
// Payments go to the Probe's wallets (they fund the measurements) unless PROBE_RECEIVE_* say otherwise.
import { createFacilitatorConfig } from "@payai/facilitator";
import { HTTPFacilitatorClient, type RouteConfig, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { NETWORKS } from "./config.js";

export const RECEIVE = {
  solana: process.env.PROBE_RECEIVE_SOLANA || "xgtJ5j3VfuYG4cxAxsQjTKWsnVdFTLPYK8NxQnpFZW5",
  base: process.env.PROBE_RECEIVE_BASE || "0x9A1066FEec0822996875a28A3D4e058175AF6C92",
};

export function routeConfig(price: string, description: string, resource: string): RouteConfig {
  return {
    accepts: [
      { scheme: "exact", network: NETWORKS.solana.caip2 as `${string}:${string}`, payTo: RECEIVE.solana, price, extra: { resource } },
      { scheme: "exact", network: NETWORKS.base.caip2 as `${string}:${string}`, payTo: RECEIVE.base, price, extra: { resource } },
    ],
    description,
    resource,
  } as RouteConfig;
}

let server: x402ResourceServer | null = null;
function resourceServer(): x402ResourceServer {
  if (server) return server;
  server = new x402ResourceServer([new HTTPFacilitatorClient(createFacilitatorConfig(process.env.PAYAI_API_KEY_ID, process.env.PAYAI_API_KEY_SECRET))]);
  registerExactSvmScheme(server);
  registerExactEvmScheme(server);
  return server;
}

function adapter(req: Request, body: unknown) {
  const u = new URL(req.url);
  return {
    getHeader: (n: string) => req.headers.get(n) || undefined,
    getMethod: () => req.method,
    getPath: () => u.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") || "",
    getUserAgent: () => req.headers.get("user-agent") || "",
    getQueryParams: () => Object.fromEntries(u.searchParams),
    getQueryParam: (n: string) => u.searchParams.get(n) ?? undefined,
    getBody: async () => body,
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), { status, headers: { "content-type": "application/json", ...headers } });

/** What a paid route does once the payment is verified: refuse (nothing is settled) or commit after settlement. */
export type Prepared = { refuse: Response } | { commit: () => Promise<Response> };

/**
 * Wrap a paid route. `prepare` validates the request (it gets the parsed JSON body); a refusal
 * cancels the payment, so a refused request is never charged. Otherwise the payment is settled
 * FIRST and only then `commit` stores and answers — an unsettled payment never buys anything.
 */
export function withPaywall(rc: RouteConfig, prepare: (req: Request, body: unknown) => Promise<Prepared>) {
  let http: x402HTTPResourceServer | null = null;
  let init: Promise<void> | null = null;
  return async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.clone().json();
    } catch {
      body = undefined;
    }
    http ??= new x402HTTPResourceServer(resourceServer(), { "*": rc });
    try {
      await (init ??= http.initialize());
    } catch (e) {
      init = null;
      return json(503, { error: "payment_unavailable", message: `payment facilitator unreachable: ${(e as Error).message}` }, { "retry-after": "60" });
    }
    const a = adapter(req, body);
    const ctx = { adapter: a, path: a.getPath(), method: req.method, paymentHeader: a.getHeader("payment-signature") || a.getHeader("x-payment") };
    const result: any = await http.processHTTPRequest(ctx as any);
    if (result.type === "payment-error") {
      const r = result.response;
      return new Response(r.isHtml ? r.body : JSON.stringify(r.body ?? {}), { status: r.status, headers: { ...r.headers, "content-type": r.isHtml ? "text/html" : "application/json" } });
    }
    const p = await prepare(req, body);
    if ("refuse" in p) {
      if (result.type === "payment-verified") await result.cancellationDispatcher?.cancel({ reason: "handler_failed", responseStatus: p.refuse.status });
      return p.refuse;
    }
    if (result.type !== "payment-verified") return p.commit();
    const settled: any = await http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, {
      request: ctx, responseBody: Buffer.alloc(0), responseHeaders: {},
    } as any);
    if (!settled.success) {
      const r = settled.response;
      return new Response(JSON.stringify({ error: "settlement_failed", detail: r?.body ?? null, message: "Not charged, nothing registered. Retry shortly." }),
        { status: 503, headers: { "content-type": "application/json", "retry-after": "60" } });
    }
    const res = await p.commit();
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(settled.headers as Record<string, string>)) headers.set(k, v);
    return new Response(await res.arrayBuffer(), { status: res.status, headers });
  };
}
