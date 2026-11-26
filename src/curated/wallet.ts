// Payments made with a person's wallet (Phantom / Rabby) rather than the Probe's own key.
// Only successful payments are published: the tx is final on chain and the seller returned the data.
// Failed attempts stay in config/wallet-payments.json as records but are not shown, because their
// causes are many (facilitator, receiving account, seller, delegation) and are not one seller's fault.
// Nothing here pays or signs. The paying wallet's address is never stored or shown.

export const OUTCOMES = ["delivered", "facilitator_rejected", "wallet_simulation_stopped", "seller_error", "agentpay_mismatch", "signature_check_failed"] as const;
export type WalletOutcome = (typeof OUTCOMES)[number];

export type WalletRecord = {
  seller: string | null; host: string | null; endpoint: string | null; network: "solana" | "base"; wallet: string; wallet_account?: "eoa" | "eip7702";
  fee_payer: string | null; settle_sender?: string | null; amount_usd: number | null; outcome: WalletOutcome; reason: string | null; tx: string | null;
  attempted_at: string | null; block?: number; source: string;
  account_check?: { method: string; result: string; note?: string };
  no_transfer_checked?: { at: string; how: string };
};

const short = (a: string) => `${a.slice(0, 6)}…`;

/**
 * Who settled, as published. Solana: the fee payer's facilitator, named only when the name is
 * confirmed by that facilitator's own /supported (`named`); otherwise the fee payer, shortened.
 * Base: the 402 names no facilitator, so the settle transaction's sender, shortened, with no name.
 */
export function settledBy(r: Pick<WalletRecord, "network" | "fee_payer" | "settle_sender">, map: Record<string, string>, named: string[]): string | null {
  if (r.network === "base") return r.settle_sender ? short(r.settle_sender) : null;
  if (!r.fee_payer) return null;
  const name = map[r.fee_payer];
  return name && named.includes(name) ? name : `${r.fee_payer.slice(0, 5)}…`;
}

/** Successful payments per facilitator (or Base settle sender). */
export function tallyDelivered(records: PublicWalletRecord[]): { facilitator: string; network: string; delivered: number }[] {
  const by = new Map<string, { facilitator: string; network: string; delivered: number }>();
  for (const r of records) {
    const k = `${r.network}|${r.facilitator ?? "unknown"}`;
    const t = by.get(k) ?? { facilitator: r.facilitator ?? "unknown", network: r.network, delivered: 0 };
    t.delivered++;
    by.set(k, t);
  }
  return [...by.values()].sort((a, b) => b.delivered - a.delivered || a.facilitator.localeCompare(b.facilitator));
}

export const SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const BASE_RPCS = () => [...new Set([process.env.BASE_RPC_URL, "https://mainnet.base.org", "https://base-rpc.publicnode.com"].filter(Boolean) as string[])];

async function rpc<T>(urls: string[], method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const u of urls)
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
        const j: any = await r.json();
        if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 120)}`);
        return j.result as T;
      } catch (e) {
        last = e;
        await new Promise((s) => setTimeout(s, 800 * (i + 1)));
      }
    }
  throw last;
}

export type TxCheck = { finalized: boolean; error: string | null; block_time: string | null };

/** Solana: finalized without error. Only the signature is used. */
export async function verifySolanaTx(sig: string): Promise<TxCheck> {
  const urls = [...new Set([process.env.SOLANA_RPC_URL || SOLANA_PUBLIC_RPC, SOLANA_PUBLIC_RPC])];
  try {
    const st = await rpc<{ value: ({ confirmationStatus: string; err: unknown } | null)[] }>(urls, "getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
    const s = st.value[0];
    if (!s) return { finalized: false, error: "not found", block_time: null };
    const tx = await rpc<{ blockTime: number | null } | null>(urls, "getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" }]).catch(() => null);
    return { finalized: s.confirmationStatus === "finalized" && !s.err, error: s.err ? JSON.stringify(s.err).slice(0, 120) : null, block_time: tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null };
  } catch (e) {
    return { finalized: false, error: `unreadable: ${(e as Error).message.slice(0, 80)}`, block_time: null };
  }
}

/** Base: the receipt succeeded and its block is at or below the chain's finalized block. */
export async function verifyBaseTx(hash: string): Promise<TxCheck> {
  try {
    const rc = await rpc<{ status: string; blockNumber: string } | null>(BASE_RPCS(), "eth_getTransactionReceipt", [hash]);
    if (!rc) return { finalized: false, error: "not found", block_time: null };
    const fin = await rpc<{ number: string }>(BASE_RPCS(), "eth_getBlockByNumber", ["finalized", false]);
    const blk = await rpc<{ timestamp: string }>(BASE_RPCS(), "eth_getBlockByNumber", [rc.blockNumber, false]);
    const ok = rc.status === "0x1" && parseInt(rc.blockNumber, 16) <= parseInt(fin.number, 16);
    return { finalized: ok, error: rc.status === "0x1" ? null : "reverted", block_time: new Date(parseInt(blk.timestamp, 16) * 1000).toISOString() };
  } catch (e) {
    return { finalized: false, error: `unreadable: ${(e as Error).message.slice(0, 80)}`, block_time: null };
  }
}

/** The public form of a successful payment: who settled, the tx and its check; never the payer's address. */
export type PublicWalletRecord = {
  seller: string | null; network: "solana" | "base"; wallet: string; wallet_account: "eoa" | null; facilitator: string | null;
  amount_usd: number | null; tx: string; attempted_at: string | null; verified_onchain: { finalized: true; checked_at: string };
};

/** Pure: the published records — delivered, with a tx confirmed final on chain; nothing else. */
export function publicRecords(
  records: WalletRecord[], checks: Map<string, TxCheck>, map: Record<string, string>, named: string[], checkedAt: string,
): PublicWalletRecord[] {
  const out: PublicWalletRecord[] = [];
  for (const r of records) {
    if (r.outcome !== "delivered" || !r.tx) continue;
    const c = checks.get(r.tx);
    if (!c?.finalized) continue;
    out.push({
      seller: r.seller, network: r.network, wallet: r.wallet, wallet_account: r.network === "base" ? (r.wallet_account === "eoa" ? "eoa" : null) : null,
      facilitator: settledBy(r, map, named), amount_usd: r.amount_usd, tx: r.tx, attempted_at: r.attempted_at ?? c.block_time,
      verified_onchain: { finalized: true, checked_at: checkedAt },
    });
  }
  return out;
}
