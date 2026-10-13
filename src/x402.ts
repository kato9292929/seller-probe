// Parsing and validating a 402 Payment Required response, v1 or v2. Pure functions.
import { type Chain, USDC, chainOf } from "./config.js";

export type Accept = {
  scheme?: string;
  network?: string;
  chain: Chain | null;
  amount?: string; // base units: v2 `amount`, v1 `maxAmountRequired`
  asset?: string;
  payTo?: string;
  resource?: string; // v2: top-level resource.url; v1: per-accept resource
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type Parsed402 = {
  spec_version: "v1" | "v2" | null;
  /** Where the requirements were read from. */
  source: "header" | "body" | null;
  accepts: Accept[];
  raw: unknown;
  error?: string;
};

function b64json(s: string): unknown {
  return JSON.parse(Buffer.from(s.trim(), "base64").toString("utf8"));
}

export function parse402(getHeader: (n: string) => string | null, bodyText: string): Parsed402 {
  let doc: any = null;
  let source: Parsed402["source"] = null;
  const h = getHeader("payment-required");
  if (h) {
    try {
      doc = b64json(h);
      source = "header";
    } catch {
      return { spec_version: null, source: "header", accepts: [], raw: h.slice(0, 500), error: "PAYMENT-REQUIRED header is not base64 JSON" };
    }
  } else {
    try {
      doc = JSON.parse(bodyText);
      source = "body";
    } catch {
      return { spec_version: null, source: null, accepts: [], raw: bodyText.slice(0, 500), error: "no PAYMENT-REQUIRED header and body is not JSON" };
    }
  }
  const v = doc?.x402Version;
  const spec_version = v === 2 ? "v2" : v === 1 ? "v1" : null;
  const topResource = typeof doc?.resource === "object" ? doc?.resource?.url : undefined;
  const accepts: Accept[] = (Array.isArray(doc?.accepts) ? doc.accepts : []).map((a: any) => ({
    scheme: str(a?.scheme),
    network: str(a?.network),
    chain: chainOf(str(a?.network)),
    amount: str(a?.amount ?? a?.maxAmountRequired),
    asset: str(a?.asset),
    payTo: str(a?.payTo),
    resource: str(spec_version === "v2" ? (topResource ?? a?.resource ?? a?.extra?.resource) : (a?.resource ?? topResource)),
    maxTimeoutSeconds: typeof a?.maxTimeoutSeconds === "number" ? a.maxTimeoutSeconds : undefined,
    extra: a?.extra && typeof a.extra === "object" ? a.extra : undefined,
    raw: a ?? {},
  }));
  return { spec_version, source, accepts, raw: doc, ...(spec_version ? {} : { error: `unknown x402Version ${JSON.stringify(v)}` }) };
}

const str = (v: unknown) => (typeof v === "string" && v.length ? v : typeof v === "number" ? String(v) : undefined);

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Field problems for one accept (empty = valid). Only Solana/Base accepts are judged. */
export function fieldProblems(a: Accept): string[] {
  const p: string[] = [];
  if (!a.scheme) p.push("scheme missing");
  if (!a.network) p.push("network missing");
  else if (!a.chain) p.push(`network ${a.network} is not Solana/Base mainnet`);
  if (!a.amount) p.push("amount missing");
  else if (!/^\d+$/.test(a.amount) || BigInt(a.amount) <= 0n) p.push(`amount ${a.amount} is not a positive integer`);
  const addr = a.chain === "base" ? EVM_ADDR : SOL_ADDR;
  if (!a.asset) p.push("asset missing");
  else if (a.chain && !addr.test(a.asset)) p.push("asset is not an address");
  if (!a.payTo) p.push("payTo missing");
  else if (a.chain && !addr.test(a.payTo)) p.push("payTo is not an address");
  if (!a.resource) p.push("resource missing");
  else {
    try {
      new URL(a.resource);
    } catch {
      p.push("resource is not a URL");
    }
  }
  return p;
}

export const isOfficialUsdc = (a: Accept) =>
  !!a.chain && !!a.asset && (a.chain === "base" ? a.asset.toLowerCase() === USDC.base.toLowerCase() : a.asset === USDC.solana);

/**
 * The accept the probe judges and (in the paid probe) pays: the first Solana/Base
 * `exact` accept in official USDC, else the first Solana/Base accept of any kind.
 */
export function primaryAccept(p: Parsed402): Accept | undefined {
  const onChain = p.accepts.filter((a) => a.chain);
  return onChain.find((a) => a.scheme === "exact" && isOfficialUsdc(a)) ?? onChain[0];
}
