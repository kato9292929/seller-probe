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

export type TransferCheck = { ok: boolean; reason: string; block?: number; err?: unknown; fee_payer?: string };

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
  if (BigInt(hit.data) !== w.amount) return { ok: false, reason: `USDC Transfer value ${BigInt(hit.data)} != ${w.amount}`, block, fee_payer };
  return { ok: true, reason: "USDC transfer matches 402", block, fee_payer };
}

export async function verifyBaseTransfer(txHash: string, w: { payer: string; payTo: string; amount: bigint }): Promise<TransferCheck> {
  for (let i = 0; i < 6; i++) {
    const r = await rpc(BASE_RPC(), "eth_getTransactionReceipt", [txHash]).catch(() => null);
    if (r) return checkBaseTransfer(r, w);
    await sleep(5000);
  }
  return { ok: false, reason: "receipt not found" };
}

/** After a failed paid request: the tx that consumed our authorization nonce, if any. */
export async function findBasePayment(
  payer: string, nonce: string, timeoutMs = 90_000, at?: Date,
): Promise<{ hash: string; receipt: any } | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const latest = parseInt(await rpc<string>(BASE_RPC(), "eth_blockNumber", []), 16);
    // Recent payment: the last ~hour. Older one (`at`): a narrow window around its time (2 s blocks).
    const centre = at ? latest - Math.round((Date.now() - at.getTime()) / 2000) : latest;
    const from = Math.max(0, at ? centre - 900 : latest - 1800);
    const to = at ? Math.min(latest, centre + 900) : latest;
    const logs: any[] = await rpc(BASE_RPC(), "eth_getLogs", [
      { address: USDC.base, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [AUTHORIZATION_USED, topicAddr(payer), nonce.toLowerCase()] },
    ]).catch(() => []);
    if (logs.length) {
      const hash = logs[0].transactionHash;
      return { hash, receipt: await rpc(BASE_RPC(), "eth_getTransactionReceipt", [hash]).catch(() => null) };
    }
    await sleep(5000);
  }
  return null;
}
