// Append-only measurement log: log/YYYY-MM-DD.jsonl (UTC). Never rewritten or deleted.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";

export type Kind = "free" | "paid" | "paid_attempt" | "self_check" | "self_check_attempt";

export type LogRecord = { ts: string; kind: Kind; host: string; [k: string]: unknown };

export const LOG_DIR = () => resolve(ROOT, process.env.PROBE_LOG_DIR ?? "log");
export const SELF_CHECK_DIR = () => resolve(ROOT, process.env.PROBE_SELF_CHECK_DIR ?? "self-check");

const day = (d: Date) => d.toISOString().slice(0, 10);

export function append(dir: string, record: Omit<LogRecord, "ts"> & { ts?: string }): LogRecord {
  const ts = record.ts ?? new Date().toISOString();
  const full = { ...record, ts } as LogRecord;
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(full, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  appendFileSync(resolve(dir, `${ts.slice(0, 10)}.jsonl`), line + "\n");
  return full;
}

/** Records from `dir` whose file date is within the last `days` days of `now` (inclusive). */
export function readRecords(dir: string, days: number, now = new Date()): LogRecord[] {
  if (!existsSync(dir)) return [];
  const from = day(new Date(now.getTime() - days * 86_400_000));
  const out: LogRecord[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()) {
    if (f.slice(0, 10) < from) continue;
    for (const line of readFileSync(resolve(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // a torn last line from a killed run: skip it, never rewrite the file
      }
    }
  }
  const cutoff = now.getTime() - days * 86_400_000;
  return out.filter((r) => Date.parse(r.ts) >= cutoff);
}
