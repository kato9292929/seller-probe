// Constants shared by every probe. Payment limits live here, in code, on purpose:
// they are not read from env or config files so a misconfigured run cannot raise them.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const USER_AGENT = "x402-seller-probe/0.1 (+https://probe.x402jp.com)";
export const TIMEOUT_MS = 10_000;

export type Chain = "solana" | "base";

/** CAIP-2 ids (x402 v2) and v1 network names that count as each chain's mainnet. */
export const NETWORKS: Record<Chain, { caip2: string; v1: string[] }> = {
  solana: { caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", v1: ["solana", "solana-mainnet"] },
  base: { caip2: "eip155:8453", v1: ["base", "base-mainnet"] },
};

/** Official USDC on each chain (Circle). Compared case-insensitively on Base. */
export const USDC: Record<Chain, string> = {
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export function chainOf(network: string | undefined): Chain | null {
  if (!network) return null;
  const n = network.toLowerCase();
  for (const c of Object.keys(NETWORKS) as Chain[]) {
    if (n === NETWORKS[c].caip2.toLowerCase() || NETWORKS[c].v1.includes(n)) return c;
  }
  return null;
}

/** USDC base units (6 decimals). */
export const LIMITS = {
  /** $0.01 per call. */
  perCall: 10_000n,
  /** $5 per rolling 7 days. */
  perWeek: 5_000_000n,
  /** Catalog price ceiling for paid targets, in USD. */
  catalogMaxPriceUsd: 0.01,
} as const;

export const ENDPOINT_REPO = "https://github.com/kato9292929/endpoint";
export const ENDPOINT_RAW = "https://raw.githubusercontent.com/kato9292929/endpoint";
