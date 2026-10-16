// Where the probe's keys come from: env (GitHub Actions Secrets, or .env), else the
// local files written by `npm run wallet:new`. Secret names here are the ones the
// wallet script prints and the README lists.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import bs58 from "bs58";
import { ROOT } from "./config.js";

export const SECRET_NAMES = {
  solana: "PROBE_SOLANA_SECRET_KEY",
  base: "PROBE_EVM_PRIVATE_KEY",
} as const;

export const KEY_FILES = {
  solana: () => resolve(ROOT, ".keys/probe-solana.json"),
  base: () => resolve(ROOT, ".keys/probe-base.key"),
};

/** Fill missing key env vars from .keys/ (local runs only; Actions has no .keys/). */
export function loadLocalKeys(): void {
  if (!process.env[SECRET_NAMES.solana] && existsSync(KEY_FILES.solana()))
    process.env[SECRET_NAMES.solana] = bs58.encode(Uint8Array.from(JSON.parse(readFileSync(KEY_FILES.solana(), "utf8"))));
  if (!process.env[SECRET_NAMES.base] && existsSync(KEY_FILES.base()))
    process.env[SECRET_NAMES.base] = readFileSync(KEY_FILES.base(), "utf8").trim();
}

/** Which wallet secrets are missing. The probe can run if at least one chain has a key. */
export function walletStatus(): { missing: string[]; configured: string[]; usable: boolean } {
  const missing = Object.values(SECRET_NAMES).filter((n) => !process.env[n]);
  const configured = Object.values(SECRET_NAMES).filter((n) => process.env[n]);
  return { missing, configured, usable: configured.length > 0 };
}
