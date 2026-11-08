// Base mainnet: probe signer and USDC transfer checks for x402 exact-EVM (EIP-3009
// transferWithAuthorization). The payer never sends a tx; the facilitator does, so the
// payer-side key for finding the payment is the authorization nonce, consumed on chain
// by USDC's AuthorizationUsed(authorizer, nonce) event.
import { privateKeyToAccount } from "viem/accounts";
import { USDC } from "../config.js";
import { rpc, sleep } from "./rpc.js";

export const BASE_RPC = () => process.env.BASE_RPC_URL || "https://mainnet.base.org";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const AUTHORIZATION_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";

export function evmSigner(key = process.env.PROBE_EVM_PRIVATE_KEY) {
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key.trim())) throw new Error("PROBE_EVM_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  return privateKeyToAccount(key.trim() as `0x${string}`);
}

const topicAddr = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** The EIP-3009 authorization in an exact-EVM payload (Permit2 payloads are not paid by the probe). */
export function evmAuthorization(payload: any): { nonce: string; signature: string; from: string; to: string; value: string } {
  const p = payload?.payload;
  if (!p?.authorization?.nonce || !p?.signature) throw new Error("EVM payload is not an EIP-3009 authorization");
  return { nonce: p.authorization.nonce, signature: p.signature, from: p.authorization.from, to: p.authorization.to, value: String(p.authorization.value) };
}

/** `transferred`: USDC (atomic) moved payer→payTo in this tx, when it could be read. */
export type TransferCheck = { ok: boolean; reason: string; block?: number; err?: unknown; fee_payer?: string; transferred?: bigint };

/** Pure: does a receipt contain a USDC Transfer of exactly `amount` from payer to payTo? */
export function checkBaseTransfer(receipt: any, w: { payer: string; payTo: string; amount: bigint }): TransferCheck {
  if (!receipt) return { ok: false, reason: "receipt not found" };
  const block = parseInt(receipt.blockNumber, 16);
  const fee_payer = receipt.from;
  if (receipt.status !== "0x1") return { ok: false, reason: "transaction reverted", block, fee_payer };
  const hit = (receipt.logs ?? []).find(
    (l: any) =>
      l.address?.toLowerCase() === USDC.base.toLowerCase() &&
      l.topics?.[0] === TRANSFER &&
      l.topics?.[1]?.toLowerCase() === topicAddr(w.payer) &&
      l.topics?.[2]?.toLowerCase() === topicAddr(w.payTo),
  );
  if (!hit) return { ok: false, reason: "no USDC Transfer payer→payTo in receipt", block, fee_payer };
  const transferred = BigInt(hit.data);
  if (transferred !== w.amount) return { ok: false, reason: `USDC Transfer value ${transferred} != ${w.amount}`, block, fee_payer, transferred };
  return { ok: true, reason: "USDC transfer matches 402", block, fee_payer, transferred };
}

export async function verifyBaseTransfer(txHash: string, w: { payer: string; payTo: string; amount: bigint }): Promise<TransferCheck> {
  for (let i = 0; i < 6; i++) {
    const r = await rpc(BASE_RPC(), "eth_getTransactionReceipt", [txHash]).catch(() => null);
    if (r) return checkBaseTransfer(r, w);
    await sleep(5000);
  }
  return { ok: false, reason: "receipt not found" };
}

/** RPCs tried in turn for log searches: the configured one, then a public one that serves eth_getLogs. */
const LOG_RPCS = () => [...new Set([BASE_RPC(), "https://base-rpc.publicnode.com"])];

/**
 * EIP-3009 `authorizationState(authorizer, nonce)` on USDC: true once the nonce has been used,
 * i.e. the signed transfer (exactly this value to this payTo) happened. An eth_call, so it does
 * not depend on any RPC's log index (which can refuse or come back incomplete).
 */
export async function authorizationUsed(payer: string, nonce: string): Promise<boolean | null> {
  const data = "0xe94a0102" + payer.toLowerCase().replace(/^0x/, "").padStart(64, "0") + nonce.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  for (const url of LOG_RPCS()) {
    try {
      return BigInt(await rpc<string>(url, "eth_call", [{ to: USDC.base, data }, "latest"], 2)) !== 0n;
    } catch {
      /* next RPC */
    }
  }
  return null;
}

/**
 * After a paid request without a settlement tx: the tx that consumed our authorization nonce.
 * `{ hash: null, used: true }` when the nonce is used on chain but no RPC's logs locate the tx
 * (seen 2026-11-08: mainnet.base.org refuses eth_getLogs, publicnode answers incompletely);
 * null only when the nonce is unused (or nothing could be read).
 */
export async function findBasePayment(
  payer: string, nonce: string, timeoutMs = 90_000, at?: Date,
): Promise<{ hash: string; receipt: any } | { hash: null; receipt: null; used: true } | null> {
  const until = Date.now() + timeoutMs;
  do {
    for (const url of LOG_RPCS()) {
      try {
        const latest = parseInt(await rpc<string>(url, "eth_blockNumber", [], 2), 16);
        // Recent payment: the last ~hour. Older one (`at`): a narrow window around its time (2 s blocks).
        const centre = at ? latest - Math.round((Date.now() - at.getTime()) / 2000) : latest;
        const from = Math.max(0, at ? centre - 900 : latest - 1800);
        const to = at ? Math.min(latest, centre + 900) : latest;
        const logs: any[] = await rpc(url, "eth_getLogs", [
          { address: USDC.base, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [AUTHORIZATION_USED, topicAddr(payer), nonce.toLowerCase()] },
        ], 2);
        if (logs.length) {
          const hash = logs[0].transactionHash;
          return { hash, receipt: await rpc(url, "eth_getTransactionReceipt", [hash]).catch(() => null) };
        }
      } catch {
        /* refused or failed: the next RPC */
      }
    }
    if (await authorizationUsed(payer, nonce)) return { hash: null, receipt: null, used: true };
    if (Date.now() < until) await sleep(5000);
  } while (Date.now() < until);
  return null;
}
