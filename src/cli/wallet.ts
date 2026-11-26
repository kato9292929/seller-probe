// Wallet payments (targets/wallet-payments.json) and the pre-payment wallet check of every curated
// endpoint (targets/wallet-precheck.json). Run before the Monday purchase (paid-weekly) and when a
// wallet record is added. Pays nothing and signs nothing: one unpaid 402 per endpoint and RPC reads.
//   npm run wallet
import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config.js";
import type { CuratedFile } from "../curated/curate.js";
import {
  type PublicWalletRecord, type WalletRecord, accountExists, associatedTokenAccount, facilitatorName, tallyByFacilitator, verifySolanaTx,
} from "../curated/wallet.js";
import { facilitatorFromExtra, loadFeePayerMap } from "../facilitator.js";
import { errMsg, timedRequest } from "../http.js";
import { LOG_DIR } from "../log.js";
import { isOfficialUsdc, parse402 } from "../x402.js";

const now = new Date().toISOString();
const map = loadFeePayerMap();

// ---- 1. wallet records, each tx checked on chain
const src: { records: WalletRecord[] } = JSON.parse(readFileSync(resolve(ROOT, "config/wallet-payments.json"), "utf8"));
const records: PublicWalletRecord[] = [];
for (const r of src.records) {
  let verified: PublicWalletRecord["verified_onchain"];
  let attempted_at = r.attempted_at;
  if (r.tx && r.network === "solana") {
    const v = await verifySolanaTx(r.tx);
    verified = { status: v.finalized ? "finalized" : "not_finalized", checked_at: now, detail: v.error };
    attempted_at ??= v.block_time;
  } else if (r.no_transfer_checked) {
    verified = { status: "no_transfer", checked_at: r.no_transfer_checked.at, detail: r.no_transfer_checked.how };
  } else verified = { status: "not_applicable", checked_at: now, detail: null };
  records.push({ ...r, attempted_at, facilitator: facilitatorName(r.fee_payer, map), verified_onchain: verified });
  console.log(`record ${r.seller ?? "-"} ${r.outcome} ${r.tx ? r.tx.slice(0, 8) + "… " + verified.status : ""}`);
}
const by_facilitator = tallyByFacilitator(src.records, map);
writeFileSync(
  resolve(ROOT, "targets/wallet-payments.json"),
  JSON.stringify({ generated_at: now, note: "Payments the owner signed in a wallet through AgentPay402. No payer address is kept.", records, by_facilitator }, null, 1) + "\n",
);

// ---- 2. pre-payment check of every curated endpoint
const curated: CuratedFile = JSON.parse(readFileSync(resolve(ROOT, "targets/curated.json"), "utf8"));
// The documented request of each endpoint's latest purchase (the same request the purchase sends unpaid first).
const request = new Map<string, { method: string; url: string; body?: unknown; content_type?: string | null }>();
for (const f of readdirSync(LOG_DIR()).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f >= "2026-11-08").sort())
  for (const line of readFileSync(resolve(LOG_DIR(), f), "utf8").split("\n")) {
    if (!line.includes('"pick":"curated"')) continue;
    try {
      const r = JSON.parse(line);
      if (r.kind === "paid" && r.request) request.set(r.curated_id, r.request);
    } catch {
      /* torn line */
    }
  }

type Pre = {
  checked_at: string; status: number | null; error: string | null;
  solana: { fee_payer: string | null; facilitator: string | null; facilitator_by: string; pay_to: string; ata: string; ata_exists: boolean | null } | null;
  base: { pay_to: string } | null;
};
const out: Record<string, Pre> = {};
const byHost = new Map<string, CuratedFile["items"]>();
for (const i of curated.items) (byHost.get(i.host) ?? byHost.set(i.host, []).get(i.host)!).push(i);
const queues = [...byHost.values()];
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < queues.length)
      for (const it of queues[next++]) {
        const rq = request.get(it.id) ?? { method: "GET", url: it.url };
        const pre: Pre = { checked_at: new Date().toISOString(), status: null, error: null, solana: null, base: null };
        try {
          const r = await timedRequest({ method: rq.method, url: rq.url, body: rq.body ?? undefined, content_type: rq.content_type ?? null }, {}, 15_000);
          pre.status = r.res.status;
          if (r.res.status === 402) {
            const p = parse402((n) => r.res.headers.get(n), r.body.toString("utf8"));
            const sol = p.accepts.find((a) => a.chain === "solana" && a.scheme === "exact" && isOfficialUsdc(a));
            const base = p.accepts.find((a) => a.chain === "base" && a.scheme === "exact" && isOfficialUsdc(a));
            if (sol?.payTo) {
              const fac = facilitatorFromExtra(sol.extra, map);
              const ata = await associatedTokenAccount(sol.payTo);
              pre.solana = {
                fee_payer: fac.fee_payer,
                facilitator: fac.by === "extra.feePayer" ? facilitatorName(fac.fee_payer, map) : fac.by === "none" ? null : fac.facilitator,
                facilitator_by: fac.by, pay_to: sol.payTo, ata, ata_exists: await accountExists(ata),
              };
            }
            if (base?.payTo) pre.base = { pay_to: base.payTo };
          }
        } catch (e) {
          pre.error = errMsg(e);
        }
        out[it.id] = pre;
        console.log(`${it.host} ${new URL(it.url).pathname.slice(0, 40)}: ${pre.status ?? pre.error} sol=${pre.solana ? `${pre.solana.facilitator} ata=${pre.solana.ata_exists}` : "-"} base=${pre.base ? "yes" : "-"}`);
      }
  }),
);
writeFileSync(resolve(ROOT, "targets/wallet-precheck.json"), JSON.stringify({ generated_at: now, items: out }, null, 1) + "\n");
const fac: Record<string, number> = {};
for (const p of Object.values(out)) {
  const k = p.solana ? (p.solana.facilitator ?? "unknown") : p.status === 402 ? "(no Solana USDC)" : `(no 402: ${p.status ?? p.error})`;
  fac[k] = (fac[k] ?? 0) + 1;
}
console.log(`precheck: ${Object.keys(out).length} endpoints; ${JSON.stringify(fac)}; ATA missing: ${Object.values(out).filter((p) => p.solana?.ata_exists === false).length}`);
