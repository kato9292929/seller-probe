// Which facilitator a seller uses, judged from the 402's `extra` (§3.2).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";

export type FacilitatorId = { facilitator: string; by: "extra.facilitator" | "extra.facilitatorUrl" | "extra.feePayer" | "none"; fee_payer: string | null };

export function loadFeePayerMap(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, "config/facilitators.json"), "utf8")).fee_payers ?? {};
  } catch {
    return {};
  }
}

export function facilitatorFromExtra(extra: Record<string, unknown> | undefined, feePayers: Record<string, string>): FacilitatorId {
  const fee_payer = typeof extra?.feePayer === "string" ? extra.feePayer : null;
  if (typeof extra?.facilitator === "string") return { facilitator: extra.facilitator, by: "extra.facilitator", fee_payer };
  if (typeof extra?.facilitatorUrl === "string") {
    let h = extra.facilitatorUrl;
    try {
      h = new URL(h).host;
    } catch {}
    return { facilitator: h, by: "extra.facilitatorUrl", fee_payer };
  }
  if (fee_payer) return { facilitator: feePayers[fee_payer] ?? `feePayer:${fee_payer}`, by: "extra.feePayer", fee_payer };
  return { facilitator: "unknown", by: "none", fee_payer };
}
