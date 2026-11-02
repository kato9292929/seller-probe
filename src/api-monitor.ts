// Entry of the Vercel function api/monitor.js (POST /monitor, paid with x402). Bundled by `npm run build:api`.
import { MONITOR_DAYS, MONITOR_PRICE, prepareRegistration } from "./monitor.js";
import { routeConfig, withPaywall } from "./paywall.js";

const RESOURCE = "https://probe.x402jp.com/monitor";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, payment-signature, x-payment",
  "access-control-expose-headers": "payment-required, payment-response",
};
let paid: ((req: Request) => Promise<Response>) | null = null;

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

export async function POST(req: Request): Promise<Response> {
  paid ??= withPaywall(
    routeConfig(MONITOR_PRICE, `x402 Seller Probe: monitor one seller URL for ${MONITOR_DAYS} days; changes are posted to your webhook`, RESOURCE),
    prepareRegistration(),
  );
  const res = await paid(req);
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
