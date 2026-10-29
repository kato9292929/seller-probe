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
  paid_outcomes: { delivered: number; not_delivered: number; request_rejected: number; delivered_unsettled: number; failed: number };
  last_rejection: { ts: string; http_status: number | null; error: string | null } | null;
  last_free_at: string | null;
  last_paid_at: string | null;
  latest: Latest;
  rfq: RfqRef;
};

export type Scores = {
  generated_at: string;
  window_days: number;
  weights_version: number;
  hosts: number;
  rfq: { status: string; fetched_at: string | null; note: string | null; used_in_score: false };
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
  history: { version: number; date: string; change: string }[];
};

export const ITEM_LABELS: Record<string, string> = {
  reachable: "HTTP 応答が返るか（10 秒）",
  status_402: "支払いなしで 402 を返すか",
  fields_valid: "402 の必須項目が揃っているか",
  asset_known: "asset が公式 USDC か",
  payto_stable: "payTo が前回から変わっていないか",
  latency_402: "402 が返るまでの時間",
  settle_ok: "/settle が成功を返したか",
  onchain_ok: "チェーン上の送金が 402 の提示と一致するか",
  delivered: "支払い後に 200 と空でない本文",
  not_delivered: "送金成立後に 200 が返らなかった（1 − 発生率）",
  latency_paid: "支払い付きリクエストから 200 まで",
  cache_header: "Cache-Control: no-store（記録のみ）",
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
