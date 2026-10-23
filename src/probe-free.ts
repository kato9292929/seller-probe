// §3.1 Free probe: GET without paying, check the 402.
import type { Target } from "./catalog.js";
import { bodySnippet, errMsg, timedGet } from "./http.js";
import { type Parsed402, fieldProblems, isOfficialUsdc, parse402, primaryAccept } from "./x402.js";

export type FreeResult = {
  kind: "free";
  host: string;
  url: string;
  /** GET, or POST when GET answered 405 (the 402 is asked for with an empty JSON body). */
  method: "GET" | "POST";
  reachable: boolean;
  http_status: number | null;
  status_402: boolean;
  spec_version: Parsed402["spec_version"];
  fields_valid: boolean;
  field_problems: string[];
  asset_known: boolean;
  network: string | null;
  chain: string | null;
  asset: string | null;
  pay_to: string | null;
  amount: string | null;
  /** null on the first observation of this host/chain (nothing to compare with). */
  payto_stable: boolean | null;
  previous_pay_to: string | null;
  latency_402_ms: number | null;
  error: string | null;
  /** On a non-402 answer: the first 300 characters of the body. */
  error_body?: string | null;
};

/** previousPayTo(host, chain) → payTo from this host's last free measurement on that chain. */
export async function probeFree(t: Target, previousPayTo: (host: string, chain: string) => string | null): Promise<FreeResult> {
  const base = { kind: "free" as const, host: t.host, url: t.url };
  let r;
  let method: "GET" | "POST" = "GET";
  try {
    r = await timedGet(t.url);
    if (r.res.status === 405) {
      method = "POST";
      r = await timedGet(t.url, {}, undefined, "POST");
    }
  } catch (e) {
    return {
      ...base, method, reachable: false, http_status: null, status_402: false, spec_version: null, fields_valid: false, field_problems: [],
      asset_known: false, network: null, chain: null, asset: null, pay_to: null, amount: null, payto_stable: null, previous_pay_to: null,
      latency_402_ms: null, error: errMsg(e),
    };
  }
  const res = r.res;
  return { ...judge402(base, res.status, (n) => res.headers.get(n), r.body.toString("utf8"), r.headers_ms, previousPayTo), method };
}

/** Pure part of the free probe (fixture-testable). */
export function judge402(
  base: { kind: "free"; host: string; url: string },
  status: number,
  getHeader: (n: string) => string | null,
  bodyText: string,
  headersMs: number,
  previousPayTo: (host: string, chain: string) => string | null,
): Omit<FreeResult, "method"> {
  const is402 = status === 402;
  const parsed = is402 ? parse402(getHeader, bodyText) : null;
  const a = parsed ? primaryAccept(parsed) : undefined;
  const problems = !is402 ? [`HTTP ${status}, not 402`] : !a ? [parsed?.error ?? "no Solana/Base accept in 402"] : fieldProblems(a);
  const prev = a?.chain && a.payTo ? previousPayTo(base.host, a.chain) : null;
  return {
    ...base,
    reachable: true,
    http_status: status,
    status_402: is402,
    spec_version: parsed?.spec_version ?? null,
    fields_valid: !!a && problems.length === 0,
    field_problems: problems,
    asset_known: !!a && isOfficialUsdc(a),
    network: a?.network ?? null,
    chain: a?.chain ?? null,
    asset: a?.asset ?? null,
    pay_to: a?.payTo ?? null,
    amount: a?.amount ?? null,
    payto_stable: prev && a?.payTo ? prev === a.payTo : null,
    previous_pay_to: prev,
    latency_402_ms: is402 ? headersMs : null,
    error: null,
    error_body: is402 ? null : bodySnippet(bodyText),
  };
}
