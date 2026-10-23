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

/** The 402's own `error` text (v2: in the PAYMENT-REQUIRED document; v1: in the JSON body). */
export function x402Error(p: Parsed402 | null): string | null {
  const e = (p?.raw as any)?.error;
  return typeof e === "string" && e ? e.slice(0, 300) : null;
}

export type InputRequirement = { requires: boolean; reason: string | null; source: "bazaar" | "outputSchema" | null };

const READ_METHODS = ["GET", "HEAD"];
const nonEmpty = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v).length > 0);

/** JSON-Schema form: { properties: { method, body, queryParams }, required } (bazaar `schema.properties.input`). */
function fromInputSchema(s: any): string | null {
  const props = s?.properties ?? {};
  const m = props.method;
  const methods: unknown[] | null = Array.isArray(m?.enum) ? m.enum : typeof m?.const === "string" ? [m.const] : null;
  if (methods && !methods.some((x) => typeof x === "string" && READ_METHODS.includes(x.toUpperCase()))) return `method ${methods.join("/")}`;
  if (Array.isArray(props.body?.required) && props.body.required.length) return `body: ${props.body.required.join(", ")}`;
  if (Array.isArray(s?.required) && s.required.includes("body")) return "body required";
  if (Array.isArray(props.queryParams?.required) && props.queryParams.required.length) return `query: ${props.queryParams.required.join(", ")}`;
  return null;
}

/** Example/description form: { method, queryParams, body, bodyFields } (bazaar `info.input`, x402 v1 `outputSchema.input`). */
function fromInputInfo(i: any): string | null {
  if (!i || typeof i !== "object") return null;
  if (typeof i.method === "string" && !READ_METHODS.includes(i.method.toUpperCase())) return `method ${i.method}`;
  if (nonEmpty(i.body)) return "body";
  const requiredNames = (fields: any) =>
    fields && typeof fields === "object" && !Array.isArray(fields)
      ? Object.entries(fields).filter(([, v]) => (v as any)?.required === true).map(([k]) => k)
      : [];
  const q = requiredNames(i.queryParams);
  if (q.length) return `query: ${q.join(", ")}`;
  const b = requiredNames(i.bodyFields);
  if (b.length) return `body: ${b.join(", ")}`;
  return null;
}

/**
 * Does buying this endpoint with a bare GET need input we cannot supply? Read only from
 * the 402's own schemas (bazaar extension, outputSchema); no schema means "no known input".
 */
export function inputRequirement(p: Parsed402 | null): InputRequirement {
  const doc: any = p?.raw;
  const bazaar = doc?.extensions?.bazaar;
  const r1 = fromInputSchema(bazaar?.schema?.properties?.input) ?? fromInputInfo(bazaar?.info?.input);
  if (r1) return { requires: true, reason: r1, source: "bazaar" };
  for (const a of p?.accepts ?? []) {
    const os: any = (a.raw as any)?.outputSchema;
    const r2 = fromInputSchema(os?.input?.type === "object" ? os.input : null) ?? fromInputInfo(os?.input);
    if (r2) return { requires: true, reason: r2, source: "outputSchema" };
  }
  return { requires: false, reason: null, source: bazaar ? "bazaar" : null };
}
