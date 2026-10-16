// The probe's paying client: official USDC on Solana/Base mainnet, `exact` only,
// one requirement at a time, and never above the hard caps in config.ts.
import { createHash } from "node:crypto";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ExactSvmSchemeV1 } from "@x402/svm/v1";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactEvmSchemeV1 } from "@x402/evm/v1";
import { BASE_RPC, evmAuthorization, evmSigner } from "./chains/base.js";
import { SOLANA_RPC, payerSignature, solanaSigner } from "./chains/solana.js";
import { LIMITS, NETWORKS } from "./config.js";
import { type Accept, type Parsed402, isOfficialUsdc } from "./x402.js";

export type Payer = {
  http: x402HTTPClient;
  address: { solana: string | null; base: string | null };
};

export async function makePayer(): Promise<Payer> {
  const client = x402Client.fromConfig({
    schemes: [],
    // Library-side cap as a second fence; the probe's own check (budget.ts) runs first.
    spendControls: { maxAmountPerPayment: "$0.01" },
  });
  let sol: string | null = null;
  let evm: string | null = null;
  if (process.env.PROBE_SOLANA_SECRET_KEY) {
    const signer = await solanaSigner();
    // Mainnet only: v2 by CAIP-2 id, v1 by its network name.
    client.register(NETWORKS.solana.caip2 as `${string}:${string}`, new ExactSvmScheme(signer, { rpcUrl: SOLANA_RPC() }));
    client.registerV1("solana", new ExactSvmSchemeV1(signer, { rpcUrl: SOLANA_RPC() }));
    sol = signer.address;
  }
  if (process.env.PROBE_EVM_PRIVATE_KEY) {
    const account = evmSigner();
    client.register(NETWORKS.base.caip2 as `${string}:${string}`, new ExactEvmScheme(account, { rpcUrl: BASE_RPC() }));
    client.registerV1("base", new ExactEvmSchemeV1(account));
    evm = account.address;
  }
  if (!sol && !evm) throw new Error("no probe wallet configured (PROBE_SOLANA_SECRET_KEY / PROBE_EVM_PRIVATE_KEY)");
  return { http: new x402HTTPClient(client), address: { solana: sol, base: evm } };
}

/** Why the probe will not pay this accept, or null if it may (amount caps are checked separately). */
export function refuseReason(a: Accept | undefined, payer: Payer["address"]): string | null {
  if (!a) return "no Solana/Base accept";
  if (a.scheme !== "exact") return `scheme ${a.scheme} (only exact is paid)`;
  if (!a.chain) return `network ${a.network}`;
  if (!isOfficialUsdc(a)) return `asset ${a.asset} is not official USDC`;
  if (!payer[a.chain]) return `no ${a.chain} probe wallet configured`;
  if (!a.amount || !/^\d+$/.test(a.amount)) return `bad amount ${a.amount}`;
  if (!a.payTo) return "payTo missing";
  if (a.chain === "base" && a.extra?.assetTransferMethod && a.extra.assetTransferMethod !== "eip3009")
    return `asset transfer method ${String(a.extra.assetTransferMethod)} (only EIP-3009 is paid)`;
  if (BigInt(a.amount) > LIMITS.perCall) return `amount ${a.amount} > per-call cap ${LIMITS.perCall}`;
  return null;
}

/** Sign a payment for exactly this accept (the seller's other options are dropped). */
export async function signFor(payer: Payer, parsed: Parsed402, a: Accept): Promise<{ payload: any; headers: Record<string, string>; payer_key: Record<string, string> }> {
  const doc = parsed.raw as any;
  const payload = await payer.http.createPaymentPayload({ ...doc, accepts: [a.raw] });
  const payer_key =
    a.chain === "solana"
      ? { payer_signature: payerSignature(payload, payer.address.solana!) }
      : // The raw authorization signature is never logged: with it anyone could submit the
        // transfer. Its SHA-256 identifies it; the nonce is what the chain search uses.
        (({ nonce, signature }) => ({ authorization_nonce: nonce, authorization_signature_sha256: createHash("sha256").update(signature).digest("hex") }))(evmAuthorization(payload));
  return { payload, headers: payer.http.encodePaymentSignatureHeader(payload), payer_key };
}

export function settleFrom(payer: Payer, getHeader: (n: string) => string | null): { success: boolean; transaction: string | null; network: string | null; error: string | null } | null {
  try {
    const s: any = payer.http.getPaymentSettleResponse(getHeader);
    return { success: !!s.success, transaction: s.transaction || null, network: s.network ?? null, error: s.errorReason ?? null };
  } catch {
    return null;
  }
}
