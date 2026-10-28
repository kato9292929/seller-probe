// USDC balances of the probe wallets, read before a paid run so that hosts beyond what
// a chain can pay are deferred (in rank order) instead of failing mid-run.
import { USDC } from "./config.js";
import { BASE_RPC } from "./chains/base.js";
import { rpc } from "./chains/rpc.js";
import { SOLANA_RPC } from "./chains/solana.js";

/** Atomic USDC (6 decimals) held by `owner` on Solana, summed over its USDC token accounts. */
export async function solanaUsdc(owner: string): Promise<bigint> {
  const r: any = await rpc(SOLANA_RPC(), "getTokenAccountsByOwner", [owner, { mint: USDC.solana }, { encoding: "jsonParsed" }]);
  return (r?.value ?? []).reduce((s: bigint, a: any) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

/** Atomic USDC held by `owner` on Base (ERC-20 balanceOf). */
export async function baseUsdc(owner: string): Promise<bigint> {
  const data = "0x70a08231" + owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return BigInt(await rpc<string>(BASE_RPC(), "eth_call", [{ to: USDC.base, data }, "latest"]));
}

/**
 * A running allowance per chain, taken from the balance at the start of the run. `take`
 * returns null and reserves the amount when it fits, else the reason the host is deferred.
 */
export function balanceReserve(start: Partial<Record<string, bigint>>) {
  const left = { ...start };
  return (chain: string, amount: bigint): string | null => {
    const have = left[chain];
    if (have === undefined) return null;
    if (amount > have) return `balance: ${chain} has ${have} left in this run, needs ${amount}`;
    left[chain] = have - amount;
    return null;
  };
}
