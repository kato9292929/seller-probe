// Paying with a person's wallet (Phantom / Rabby / MetaMask) rather than the Probe's own key.
// Two things, kept apart on the page:
//  - records: payments the owner actually signed in a wallet through AgentPay402
//    (config/wallet-payments.json), each tx checked on chain;
//  - outlook: what can be known before paying, for every curated endpoint, from one unpaid 402
//    (the facilitator behind the Solana fee payer) and an RPC read (does the seller's USDC account exist).
// Nothing here pays or signs. The paying wallet's address is never stored or shown.
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { USDC } from "../config.js";

export const OUTCOMES = ["delivered", "facilitator_rejected", "wallet_simulation_stopped", "seller_error", "agentpay_mismatch", "signature_check_failed"] as const;
export type WalletOutcome = (typeof OUTCOMES)[number];

export type WalletRecord = {
  seller: string | null; host: string | null; endpoint: string | null; network: "solana" | "base"; wallet: string; wallet_account?: "eoa" | "eip7702";
  fee_payer: string | null; amount_usd: number | null; outcome: WalletOutcome; reason: string | null; tx: string | null; attempted_at: string | null;
  source: string; no_transfer_checked?: { at: string; how: string };
};

/** A fee payer's facilitator name, or its short form when no published source names it. */
export function facilitatorName(feePayer: string | null | undefined, map: Record<string, string>): string | null {
  if (!feePayer) return null;
  return map[feePayer] ?? `${feePayer.slice(0, 5)}…`;
}

/** Per facilitator: Phantom payments tried, delivered, refused by the facilitator. */
export type FacilitatorTally = { facilitator: string; phantom_attempts: number; delivered: number; rejected: number };
export function tallyByFacilitator(records: WalletRecord[], map: Record<string, string>): FacilitatorTally[] {
  const by = new Map<string, FacilitatorTally>();
  for (const r of records) {
    if (r.wallet !== "Phantom") continue;
    const f = facilitatorName(r.fee_payer, map) ?? "unknown";
    const t = by.get(f) ?? { facilitator: f, phantom_attempts: 0, delivered: 0, rejected: 0 };
    t.phantom_attempts++;
    if (r.outcome === "delivered") t.delivered++;
    if (r.outcome === "facilitator_rejected") t.rejected++;
    by.set(f, t);
  }
  return [...by.values()].sort((a, b) => b.phantom_attempts - a.phantom_attempts || a.facilitator.localeCompare(b.facilitator));
}

/**
 * Outlook for paying with Phantom, from the records and the unpaid checks (an outlook, not a record):
 *  accepted_facilitator  the facilitator has accepted a Phantom transaction in the records
 *  rejected_facilitator  it has refused one and accepted none
 *  no_ata                the seller's USDC account does not exist (the transfer fails whatever the facilitator)
 *  unverified            none of the above
 *  no_solana             the 402 offers no Solana USDC payment (Phantom pays on Solana)
 */
export type Outlook = "accepted_facilitator" | "rejected_facilitator" | "no_ata" | "unverified" | "no_solana";
export function outlookFor(pre: { solana: { facilitator: string | null; ata_exists: boolean | null } | null }, tallies: FacilitatorTally[]): Outlook {
  if (!pre.solana) return "no_solana";
  if (pre.solana.ata_exists === false) return "no_ata";
  const t = tallies.find((x) => x.facilitator === pre.solana!.facilitator);
  if (t?.delivered) return "accepted_facilitator";
  if (t?.rejected) return "rejected_facilitator";
  return "unverified";
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** The associated token account of `owner` for `mint` (classic token program unless told otherwise). */
export async function associatedTokenAccount(owner: string, mint: string = USDC.solana, tokenProgram = TOKEN_PROGRAM): Promise<string> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [enc.encode(address(owner)), enc.encode(address(tokenProgram)), enc.encode(address(mint))],
  });
  return pda;
}
export const TOKEN_PROGRAMS = { classic: TOKEN_PROGRAM, token2022: TOKEN_2022 };

export const SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
export async function solanaRpc<T = any>(method: string, params: unknown[], url = process.env.SOLANA_RPC_URL || SOLANA_PUBLIC_RPC): Promise<T> {
  let last: unknown;
  for (const u of [...new Set([url, SOLANA_PUBLIC_RPC])])
    for (let i = 0; i < 4; i++) {
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

/** Does this account exist on chain? null when it could not be read. */
export async function accountExists(addr: string): Promise<boolean | null> {
  try {
    const r = await solanaRpc<{ value: unknown | null }>("getAccountInfo", [addr, { encoding: "base64", commitment: "confirmed" }]);
    return r.value !== null;
  } catch {
    return null;
  }
}

/** A Solana payment tx: finalized without error, and when it landed. Only the signature is used. */
export async function verifySolanaTx(sig: string): Promise<{ finalized: boolean; error: string | null; block_time: string | null }> {
  try {
    const st = await solanaRpc<{ value: ({ confirmationStatus: string; err: unknown } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
    const s = st.value[0];
    if (!s) return { finalized: false, error: "not found", block_time: null };
    const tx = await solanaRpc<{ blockTime: number | null } | null>("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" }]).catch(() => null);
    return {
      finalized: s.confirmationStatus === "finalized" && !s.err,
      error: s.err ? JSON.stringify(s.err).slice(0, 120) : null,
      block_time: tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    };
  } catch (e) {
    return { finalized: false, error: `unreadable: ${(e as Error).message.slice(0, 80)}`, block_time: null };
  }
}

/** The public form of a record: facilitator named, tx checked; never the payer's address. */
export type PublicWalletRecord = Omit<WalletRecord, "source"> & {
  facilitator: string | null; source: string;
  verified_onchain: { status: "finalized" | "not_finalized" | "no_transfer" | "not_applicable"; checked_at: string; detail: string | null };
};
