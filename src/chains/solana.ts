// Solana mainnet: probe signer, the buyer's own signature in an x402 exact-SVM
// payment tx, finding that tx on chain, and checking a USDC transfer in it.
import bs58 from "bs58";
import { createKeyPairSignerFromBytes, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { USDC } from "../config.js";
import { rpc, sleep } from "./rpc.js";

export const SOLANA_RPC = () => process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export async function solanaSigner(secret = process.env.PROBE_SOLANA_SECRET_KEY) {
  if (!secret) throw new Error("PROBE_SOLANA_SECRET_KEY is not set");
  const bytes = secret.trim().startsWith("[") ? Uint8Array.from(JSON.parse(secret)) : bs58.decode(secret.trim());
  if (bytes.length !== 64) throw new Error(`PROBE_SOLANA_SECRET_KEY must be 64 bytes, got ${bytes.length}`);
  return createKeyPairSignerFromBytes(bytes);
}

/** The payer's signature inside payload.payload.transaction (base64 wire tx). Fixed once signed. */
export function payerSignature(payload: any, payer: string): string {
  const b64 = payload?.payload?.transaction;
  if (typeof b64 !== "string") throw new Error("SVM payload has no payload.transaction");
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(b64));
  const sig = (tx.signatures as Record<string, Uint8Array | null>)[payer];
  if (!sig || sig.every((b) => b === 0)) throw new Error("payer signature missing in payment tx");
  return bs58.encode(sig);
}

export type TransferCheck = { ok: boolean; reason: string; slot?: number; err?: unknown; fee_payer?: string };

/** Pure: does a jsonParsed getTransaction result move exactly `amount` USDC from `payer` to `payTo`? */
export function checkSolanaTransfer(tx: any, w: { payer: string; payTo: string; amount: bigint }): TransferCheck {
  if (!tx) return { ok: false, reason: "transaction not found" };
  const fee_payer = tx.transaction?.message?.accountKeys?.[0]?.pubkey ?? tx.transaction?.message?.accountKeys?.[0];
  if (tx.meta?.err) return { ok: false, reason: `transaction failed: ${JSON.stringify(tx.meta.err)}`, slot: tx.slot, err: tx.meta.err, fee_payer };
  const delta = (owner: string) => {
    const amt = (list: any[]) =>
      BigInt(list?.find((b) => b.mint === USDC.solana && b.owner === owner)?.uiTokenAmount?.amount ?? "0");
    return amt(tx.meta?.postTokenBalances) - amt(tx.meta?.preTokenBalances);
  };
  const toPayTo = delta(w.payTo);
  const fromPayer = delta(w.payer);
  if (toPayTo !== w.amount) return { ok: false, reason: `payTo USDC delta ${toPayTo} != ${w.amount}`, slot: tx.slot, fee_payer };
  if (fromPayer !== -w.amount) return { ok: false, reason: `payer USDC delta ${fromPayer} != -${w.amount}`, slot: tx.slot, fee_payer };
  return { ok: true, reason: "USDC transfer matches 402", slot: tx.slot, fee_payer };
}

export async function getSolanaTx(sig: string): Promise<any> {
  return rpc(SOLANA_RPC(), "getTransaction", [sig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
}

export async function verifySolanaTransfer(sig: string, w: { payer: string; payTo: string; amount: bigint }): Promise<TransferCheck> {
  // A settled tx can take a few seconds to be visible at `confirmed`.
  for (let i = 0; i < 6; i++) {
    const tx = await getSolanaTx(sig).catch(() => null);
    if (tx) return checkSolanaTransfer(tx, w);
    await sleep(5000);
  }
  return { ok: false, reason: "transaction not found" };
}

/**
 * The paid request did not return 200: look for a landed tx carrying our own signature
 * among recent transactions that touch the payer (it signs the transfer as owner).
 * In an x402 exact-SVM tx the tx id is the facilitator's (fee payer's) signature, so
 * our signature is matched against every signature of each candidate tx.
 */
export async function findSolanaPayment(payer: string, payerSig: string, timeoutMs = 90_000, limit = 20): Promise<{ signature: string; tx: any } | null> {
  const seen = new Set<string>();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const sigs: any[] = await rpc(SOLANA_RPC(), "getSignaturesForAddress", [payer, { limit, commitment: "confirmed" }]).catch(() => []);
    for (const s of sigs) {
      if (seen.has(s.signature)) continue;
      seen.add(s.signature);
      const tx = await getSolanaTx(s.signature).catch(() => null);
      if (tx?.transaction?.signatures?.includes(payerSig)) return { signature: s.signature, tx };
    }
    await sleep(5000);
  }
  return null;
}
