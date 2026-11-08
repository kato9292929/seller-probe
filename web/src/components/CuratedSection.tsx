import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "@/lib/data";
import { SectionTitle } from "./SectionTitle";

type Check = { name: string; result: "pass" | "fail" | "not_checked"; detail: string };
type Evidence = {
  ts: string; date: string; category: string | null; category_label: string | null; reason: string | null;
  request: { method: string; url: string; query: Record<string, string>; body: unknown; source: string; source_detail: string; values: { in: string; name: string; value: unknown; from: string }[] } | null;
  request_tried: string[] | null; http_status: number | null; response_sha256: string | null; response_bytes: number | null;
  tx: string | null; chain: string | null; amount: string | null; onchain_ok: boolean | null; checks: Check[] | null; body_head: string | null;
  error_body: string | null; skipped: string | null;
};
type Item = {
  id: string; operator: string; host: string; url: string; description: string | null; price_usd: number | null;
  reasons: { listed_in: string[]; operator_tx: number | null; operator_buyers: number | null; operator_stats_source: string; endpoint_calls_30d: number | null; endpoint_payers_30d: number | null; endpoint_stats_source: string };
  last: Evidence | null;
};
type Curated = {
  generated_at: string; last_run: string | null;
  categories: { key: string; label: string; definition: string; count: number }[];
  curation: { generated_at: string; rules: string[]; candidates: { operators: number; endpoints: number }; kept: number; operators_kept: number; excluded_by_reason: { key: string; label: string; count: number }[]; excluded_operators: { host: string; name: string; reason: string; detail: string }[] } | null;
  items: Item[];
  legacy_not_delivered: { date: string; not_delivered: number; by_category: { key: string; label: string; count: number }[]; rows: { host: string; url: string; http_status: unknown; category: string; reason: string }[] }[];
  own_sellers: { target: string; host: string; date: string; url: string | null; category: string | null; reason: string | null; http_status: number | null; tx: string | null; chain: string | null; response_sha256: string | null; receipt_ok: boolean | null }[];
};

const TONE: Record<string, "accent" | "outline" | "default"> = {
  as_described: "accent", not_as_described: "default", paid_then_rejected: "default", paid_not_delivered: "default",
  delivered_without_payment: "outline", input_mismatch: "outline", no_usage: "outline", over_price: "outline", not_settled: "outline", not_bought: "outline",
};
const txLink = (chain: string | null, tx: string) => (chain === "solana" ? `https://solscan.io/tx/${tx}` : `https://basescan.org/tx/${tx}`);
const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

export function CuratedSection() {
  const [d, setD] = useState<Curated | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("");
  useEffect(() => {
    getJson<Curated>("/data/curated.json").then(setD, (e) => setErr(String(e?.message ?? e)));
  }, []);
  const items = (d?.items ?? []).filter((i) => !cat || i.last?.category === cat);

  return (
    <section id="curated" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="Curated purchases" title="使い方どおりに買った結果">
        <p>
          実際に複数の買い手に使われているエンドポイントを選び、売り手が公開している呼び方（402 の定義・x402 Endpoint・Bazaar・llms.txt / OpenAPI）どおりの要求を組み立て、支払いなしで 402 が返ることを確かめてから 1 回だけ買っています。
          届いたかに加え、中身が説明どおりか（出力の型・空や誤りでない・入力の反映・鮮度・データの種類）を確かめます。毎週月曜に購入、選び直しは毎月。1コール $0.01・7日 $25 の上限はコードで固定です。
        </p>
      </SectionTitle>
      {err && <p className="text-sm text-muted-foreground">読み込めませんでした（{err}）</p>}

      <h3 className="mb-3 text-lg">判定の定義</h3>
      <div className="mb-10 rounded-xl border bg-card/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>判定</TableHead>
              <TableHead>定義</TableHead>
              <TableHead className="text-right">件数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(d?.categories ?? []).map((c) => (
              <TableRow key={c.key} className="cursor-pointer" onClick={() => setCat(cat === c.key ? "" : c.key)}>
                <TableCell className="whitespace-nowrap"><Badge variant={TONE[c.key] ?? "outline"}>{c.label}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.definition}</TableCell>
                <TableCell className="text-right tabular-nums">{d?.last_run ? c.count : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <h3 className="mb-3 text-lg">
        エンドポイントごとの結果 {cat && <button className="ml-2 text-sm text-muted-foreground underline" onClick={() => setCat("")}>（絞り込みを解除）</button>}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        最終購入：{d?.last_run ? d.last_run.slice(0, 16).replace("T", " ") + " UTC" : "まだ購入していません"}。行を開くと、送った要求（支払いヘッダ・署名は載せません）、ステータス、本文の SHA-256、送金 tx、確認の結果が見られます。
      </p>
      <div className="mb-10 space-y-2">
        {items.map((i) => (
          <details key={i.id} className="rounded-lg border bg-card/60 px-4 py-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
              <Badge variant={TONE[i.last?.category ?? ""] ?? "outline"}>{i.last?.category_label ?? "未購入"}</Badge>
              <span className="font-medium">{i.host}</span>
              <span className="break-all text-sm text-muted-foreground">{i.last?.request?.method ?? ""} {new URL(i.url).pathname}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                tx {i.reasons.endpoint_calls_30d ?? i.reasons.operator_tx ?? "—"} · buyers {i.reasons.endpoint_payers_30d ?? i.reasons.operator_buyers ?? "—"} · ${i.price_usd ?? "—"}
              </span>
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-muted-foreground">
                選んだ理由：{i.reasons.listed_in.join(", ")}（運営者 tx {i.reasons.operator_tx ?? "—"}・buyer {i.reasons.operator_buyers ?? "—"}、{i.reasons.operator_stats_source}）／エンドポイント 30日 {i.reasons.endpoint_calls_30d ?? "—"} 回・{i.reasons.endpoint_payers_30d ?? "—"} 人（{i.reasons.endpoint_stats_source}）
              </p>
              {i.last ? (
                <>
                  {i.last.reason && <p>判定の根拠：{i.last.reason}</p>}
                  {i.last.request && (
                    <div>
                      <p>要求（出どころ：{i.last.request.source} — {i.last.request.source_detail}）</p>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs">{`${i.last.request.method} ${i.last.request.url}${i.last.request.body !== null ? `\n${JSON.stringify(i.last.request.body, null, 1)}` : ""}`}</pre>
                      <p className="text-xs text-muted-foreground">値：{i.last.request.values.map((v) => `${v.name}=${JSON.stringify(v.value)}（${v.from}）`).join("、") || "なし"}</p>
                    </div>
                  )}
                  {i.last.request_tried && <p className="text-xs text-muted-foreground">探した順：{i.last.request_tried.join(" ／ ")}</p>}
                  <p className="tabular-nums">
                    HTTP {i.last.http_status ?? "—"} · {i.last.response_bytes ?? 0} bytes
                    {i.last.response_sha256 && <> · SHA-256 <code className="text-xs">{short(i.last.response_sha256, 12)}</code></>}
                    {i.last.tx && <> · tx <a className="underline" href={txLink(i.last.chain, i.last.tx)} target="_blank" rel="noreferrer">{short(i.last.tx)}</a></>}
                  </p>
                  {i.last.checks && (
                    <ul className="text-xs">
                      {i.last.checks.map((c) => (
                        <li key={c.name}>
                          {c.result === "pass" ? "✓" : c.result === "fail" ? "✗" : "–"} {c.name}：{c.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(i.last.body_head || i.last.error_body) && <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{i.last.body_head ?? i.last.error_body}</pre>}
                </>
              ) : (
                <p className="text-muted-foreground">まだ購入していません。</p>
              )}
            </div>
          </details>
        ))}
      </div>

      {d?.curation && (
        <>
          <h3 className="mb-3 text-lg">選び方</h3>
          <div className="mb-10 rounded-xl border bg-card/60 p-5 text-sm">
            <p>
              候補 {d.curation.candidates.operators} 運営者・{d.curation.candidates.endpoints.toLocaleString()} エンドポイント → 残したのは {d.curation.kept} エンドポイント（{d.curation.operators_kept} 運営者）。選び直し：{d.curation.generated_at.slice(0, 10)}
            </p>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {d.curation.rules.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="mt-3">除外の理由と件数：{d.curation.excluded_by_reason.map((e) => `${e.label} ${e.count}`).join("／")}</p>
            <p className="mt-2 text-muted-foreground">除外した運営者：{d.curation.excluded_operators.map((e) => `${e.host}（${e.reason}）`).join("、")}</p>
          </div>
        </>
      )}

      {!!d?.legacy_not_delivered.length && (
        <>
          <h3 className="mb-3 text-lg">以前の「払ったのに届かない」の読み直し</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            2026-11-07 までは入力なしの GET だけで買っていました。その時の「払ったのに届かない」を、記録はそのままに上の判定で読み直したものです（Probe 側の誤りとして除外済みのもの〔テンプレート URL〕は含みません）。
          </p>
          <div className="mb-10 space-y-2">
            {d.legacy_not_delivered.map((g) => (
              <details key={g.date} className="rounded-lg border bg-card/60 px-4 py-3">
                <summary className="cursor-pointer">
                  {g.date}：{g.not_delivered} 件 → {g.by_category.map((c) => `${c.label} ${c.count}`).join("／")}
                </summary>
                <ul className="mt-2 text-xs text-muted-foreground">
                  {g.rows.map((r) => <li key={r.url}>{r.host} — HTTP {String(r.http_status ?? "—")} — {r.category}</li>)}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}

      {!!d?.own_sellers.length && (
        <>
          <h3 className="mb-3 text-lg">自社の売り手（JIN・OSD）</h3>
          <p className="mb-3 text-xs text-muted-foreground">本サイト運営者の売り手です。上の一覧とは分けて、自己点検（再送・キャッシュの試験を含む）の最新の購入を載せています。スコアには入れていません。</p>
          <div className="rounded-xl border bg-card/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>売り手</TableHead>
                  <TableHead>判定</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>tx</TableHead>
                  <TableHead>レシート</TableHead>
                  <TableHead>日付</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.own_sellers.map((o) => (
                  <TableRow key={o.host}>
                    <TableCell>{o.target} <span className="text-xs text-muted-foreground">{o.url}</span></TableCell>
                    <TableCell>{o.category ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{o.http_status ?? "—"}</TableCell>
                    <TableCell>{o.tx ? <a className="underline" href={txLink(o.chain, o.tx)} target="_blank" rel="noreferrer">{short(o.tx)}</a> : "—"}</TableCell>
                    <TableCell>{o.receipt_ok === true ? "検証 ✓" : o.receipt_ok === false ? "✗" : "—"}</TableCell>
                    <TableCell className="tabular-nums">{o.date}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
