// USDC balances of the probe wallets, read before a paid run so that hosts beyond what
// a chain can pay are deferred (in rank order) instead of failing mid-run.
import { USDC } from "./config.js";
import { BASE_RPC } from "./chains/base.js";
import { rpc } from "./chains/rpc.js";
import { SOLANA_RPC } from "./chains/solana.js";

/** Public RPCs tried after the configured one when a balance cannot be read there. */
export const PUBLIC_RPC = { solana: "https://api.mainnet-beta.solana.com", base: "https://mainnet.base.org" } as const;

/** Atomic USDC (6 decimals) held by `owner` on Solana, summed over its USDC token accounts. */
export async function solanaUsdc(owner: string, url = SOLANA_RPC()): Promise<bigint> {
  const r: any = await rpc(url, "getTokenAccountsByOwner", [owner, { mint: USDC.solana }, { encoding: "jsonParsed" }]);
  return (r?.value ?? []).reduce((s: bigint, a: any) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

/** Atomic USDC held by `owner` on Base (ERC-20 balanceOf). */
export async function baseUsdc(owner: string, url = BASE_RPC()): Promise<bigint> {
  const data = "0x70a08231" + owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return BigInt(await rpc<string>(url, "eth_call", [{ to: USDC.base, data }, "latest"]));
}

/**
 * A chain's balance from the configured RPC, then from the public one. null when neither
 * answers: that chain is then not paid at all in this run (balanceReserve's `unreadable`).
 */
export async function readBalance(
  chain: "solana" | "base", owner: string,
  read: (owner: string, url?: string) => Promise<bigint> = chain === "solana" ? solanaUsdc : baseUsdc,
): Promise<{ balance: bigint | null; errors: string[] }> {
  const errors: string[] = [];
  const urls = [undefined, PUBLIC_RPC[chain]];
  for (const url of urls) {
    try {
      return { balance: await read(owner, url), errors };
    } catch (e) {
      errors.push(`${url ?? "configured RPC"}: ${(e as Error).message}`.slice(0, 200));
    }
  }
  return { balance: null, errors };
}

/**
 * A running allowance per chain, taken from the balance at the start of the run. `take`
 * returns null and reserves the amount when it fits, else the reason the host is deferred.
 */
export function balanceReserve(start: Partial<Record<string, bigint>>, unreadable: string[] = []) {
  const left = { ...start };
  return (chain: string, amount: bigint): string | null => {
    // A wallet whose balance could not be read anywhere is not paid from (deferred, not guessed).
    if (unreadable.includes(chain)) return `balance: ${chain} balance unreadable, not paid this run`;
    const have = left[chain];
    if (have === undefined) return null;
    if (amount > have) return `balance: ${chain} has ${have} left in this run, needs ${amount}`;
    left[chain] = have - amount;
    return null;
  };
}
