import type { L } from "./i18n";
// Shapes of the static JSON the build writes from log/ (src/cli/score.ts).
export type Latest = {
  url: string | null;
  spec_version: string | null;
  network: string | null;
  pay_to: string | null;
  amount: string | null;
  facilitator: string | null;
};

export type RfqRef = { sellers: string[]; quotes: number; awarded: number; fulfilled: number; rejected: number; not_delivered: number; fetched_at: string | null } | null;

export type ScoreRow = {
  host: string;
  score: number | null;
  coverage: "full" | "free_only";
  n_free: number;
  n_paid: number;
  n_rejected: number;
  n_unsettled: number;
  n_price_mismatch?: number;
  paid_outcomes: { delivered: number; not_delivered: number; request_rejected: number; delivered_unsettled: number; failed: number; overcharged?: number };
  last_rejection: { ts: string; http_status: number | null; error: string | null } | null;
  last_free_at: string | null;
  last_paid_at: string | null;
  receipt?: { advertised: boolean | null; ok: boolean | null; reason: string | null };
  latest: Latest;
  rfq: RfqRef;
};

export type Scores = {
  generated_at: string;
  window_days: number;
  weights_version: number;
  hosts: number;
  rfq: { status: string; fetched_at: string | null; note: string | null; used_in_score: false };
  price_mismatch?: { hosts: number; purchases: number };
  reports?: { received: number; hosts: number } | null;
  paid_targets: {
    date: string;
    phase: string;
    top: string[];
    random: string[];
    requires_input: { host: string; reason: string; pick: string }[] | null;
    dropped?: { host: string; reason: string; pick: string }[] | null;
  } | null;
  scores: ScoreRow[];
};

export type HostDetail = ScoreRow & {
  generated_at: string;
  weights_version: number;
  items: Record<string, { value: number | null; n: number; weight: number }>;
  history: Record<string, unknown>[];
};

export type Weights = {
  version: number;
  effective_from: string;
  window_days: number;
  latency_ms: { full_marks_at_or_below: number; zero_at_or_above: number };
  free: Record<string, number>;
  paid: Record<string, number>;
  history: { version: number; date: string; change: string; change_en?: string; change_zh?: string }[];
};

export const ITEM_LABELS: Record<string, L> = {
  reachable: { ja: "HTTP 応答が返るか（10 秒）", en: "Responds over HTTP (10 s)", zh: "是否有 HTTP 响应（10 秒）" },
  status_402: { ja: "支払いなしで 402 を返すか", en: "Returns 402 without payment", zh: "未付款时是否返回 402" },
  fields_valid: { ja: "402 の必須項目が揃っているか", en: "402 has every required field", zh: "402 的必填字段是否齐全" },
  asset_known: { ja: "asset が公式 USDC か", en: "Asset is official USDC", zh: "asset 是否为官方 USDC" },
  payto_stable: { ja: "payTo が前回から変わっていないか", en: "payTo unchanged since last time", zh: "payTo 与上次相比是否未变" },
  latency_402: { ja: "402 が返るまでの時間", en: "Time to the 402", zh: "返回 402 所需时间" },
  settle_ok: { ja: "/settle が成功を返したか", en: "/settle reported success", zh: "/settle 是否返回成功" },
  onchain_ok: { ja: "チェーン上の送金が 402 の提示と一致するか", en: "On-chain transfer matches the 402", zh: "链上转账是否与 402 的报价一致" },
  delivered: { ja: "支払い後に 200 と空でない本文", en: "200 with a non-empty body after paying", zh: "付款后返回 200 且正文非空" },
  not_delivered: { ja: "送金成立後に 200 が返らなかった（1 − 発生率）", en: "No 200 after the transfer landed (1 − rate)", zh: "转账成功后未返回 200（1 − 发生率）" },
  latency_paid: { ja: "支払い付きリクエストから 200 まで", en: "Paid request to 200", zh: "从付款请求到 200" },
  cache_header: { ja: "Cache-Control: no-store（記録のみ）", en: "Cache-Control: no-store (recorded only)", zh: "Cache-Control: no-store（仅记录）" },
};

export function networkName(n: string | null): string {
  if (!n) return "—";
  if (n.startsWith("solana")) return "Solana";
  if (n === "eip155:8453" || n === "base") return "Base";
  return n;
}

export const usd = (baseUnits: string | null) => (baseUnits ? `$${(Number(baseUnits) / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}` : "—");

export function scoreTone(s: number | null): string {
  if (s === null) return "text-muted-foreground";
  return s >= 80 ? "text-good" : s >= 50 ? "text-mid" : "text-bad";
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}
