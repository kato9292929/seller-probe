import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "@/lib/data";
import { type Lang, useLang } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";

type Check = { name: string; result: "pass" | "fail" | "not_checked"; detail: string };
type Evidence = {
  ts: string; date: string; category: string | null; category_label: string | null; reason: string | null;
  request: { method: string; url: string; query: Record<string, string>; body: unknown; source: string; source_detail: string; values: { in: string; name: string; value: unknown; from: string }[] } | null;
  request_tried: string[] | null; http_status: number | null; response_sha256: string | null; response_bytes: number | null;
  tx: string | null; chain: string | null; amount: string | null; onchain_ok: boolean | null; checks: Check[] | null; body_head: string | null;
  error_body: string | null; skipped: string | null;
};
export type Item = {
  id: string; operator: string; host: string; url: string; description: string | null; price_usd: number | null;
  reasons: { listed_in: string[]; operator_tx: number | null; operator_buyers: number | null; operator_stats_source: string; endpoint_calls_30d: number | null; endpoint_payers_30d: number | null; endpoint_stats_source: string };
  last: Evidence | null;
};
export type Category = { key: string; label: string; label_en?: string; label_zh?: string; definition: string; definition_en?: string; definition_zh?: string; count: number };
type ByReason = { key: string; label: string; label_en?: string; label_zh?: string; count: number };
export type Curated = {
  generated_at: string; last_run: string | null;
  categories: Category[];
  curation: {
    generated_at: string; rules: string[]; rules_i18n?: Record<Lang, string[]>; candidates: { operators: number; endpoints: number }; kept: number; operators_kept: number;
    excluded_by_reason: ByReason[]; excluded_operators: { host: string; name: string; reason: string; reason_key?: string; detail: string }[];
  } | null;
  items: Item[];
  legacy_not_delivered: { date: string; not_delivered: number; by_category: { key: string; label: string; count: number }[]; rows: { host: string; url: string; http_status: unknown; category: string; category_key?: string; reason: string }[] }[];
  own_sellers: { target: string; host: string; date: string; url: string | null; category: string | null; category_key?: string | null; reason: string | null; http_status: number | null; tx: string | null; chain: string | null; response_sha256: string | null; receipt_ok: boolean | null }[];
};

export const TONE: Record<string, "accent" | "outline" | "default"> = {
  as_described: "accent", not_as_described: "default", paid_then_rejected: "default", paid_not_delivered: "default",
  delivered_without_payment: "outline", input_mismatch: "outline", input_rejected_unpaid: "outline", no_usage: "outline", over_price: "outline", not_settled: "outline", not_bought: "outline",
};
export const txLink = (chain: string | null, tx: string) => (chain === "solana" ? `https://solscan.io/tx/${tx}` : `https://basescan.org/tx/${tx}`);
export const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

/** A labelled thing ({label, label_en, label_zh}) in the current language. */
export const pick = (x: { label: string; label_en?: string; label_zh?: string } | undefined, lang: Lang, fallback = "—") =>
  !x ? fallback : lang === "en" ? (x.label_en ?? x.label) : lang === "zh" ? (x.label_zh ?? x.label) : x.label;
const defOf = (c: Category, lang: Lang) => (lang === "en" ? (c.definition_en ?? c.definition) : lang === "zh" ? (c.definition_zh ?? c.definition) : c.definition);
/** Category key → label in the current language, from the categories the data carries. */
export const categoryLabel = (cats: Category[] | undefined, key: string | null | undefined, lang: Lang, fallback: string) =>
  pick(cats?.find((c) => c.key === key), lang, fallback);

export function CuratedSection() {
  const { t, lang } = useLang();
  const [d, setD] = useState<Curated | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("");
  useEffect(() => {
    getJson<Curated>("/data/curated.json").then(setD, (e) => setErr(String(e?.message ?? e)));
  }, []);
  const items = (d?.items ?? []).filter((i) => !cat || i.last?.category === cat);
  const notBought = t({ ja: "未購入", en: "Not bought", zh: "未购买" });
  const slash = lang === "en" ? " / " : "／";
  const reasonLabel = (k: string | undefined, fallback: string) => pick(d?.curation?.excluded_by_reason.find((e) => e.key === k), lang, fallback);

  return (
    <section id="curated" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle
        eyebrow="Curated purchases"
        title={t({ ja: "使い方どおりに買った結果", en: "Bought the way they are documented", zh: "按说明的方式购买的结果" })}
      >
        <p>
          {t({
            ja: "実際に複数の買い手に使われているエンドポイントを選び、売り手が公開している呼び方（402 の定義・x402 Endpoint・Bazaar・llms.txt / OpenAPI）どおりの要求を組み立て、支払いなしで 402 が返ることを確かめてから 1 回だけ買っています。届いたかに加え、中身が説明どおりか（出力の型・空や誤りでない・入力の反映・鮮度・データの種類）を確かめます。毎週月曜に購入、選び直しは毎月。1コール $0.01・7日 $25 の上限はコードで固定です。",
            en: "We pick endpoints that several buyers actually use, build each request the way the seller documents it (the 402's definition, x402 Endpoint, the Bazaar, llms.txt / OpenAPI), confirm that the request unpaid answers 402, and then buy once. Besides whether it arrived, we check that the content is as described (output shape, not empty or an error, input reflected, freshness, kind of data). Purchases run every Monday and the list is re-chosen monthly. The $0.01 per call and $25 per 7 days caps are fixed in code.",
            zh: "我们挑选确实有多个买家在使用的端点，按卖家公开的调用方式（402 定义、x402 Endpoint、Bazaar、llms.txt / OpenAPI）构造请求，先确认不付款时返回 402，再购买一次。除了是否送达，还检查内容是否与说明一致（输出格式、非空且非错误、输入是否反映、时效、数据种类）。每周一购买，每月重选。每次调用 $0.01、7 天 $25 的上限由代码固定。",
          })}
        </p>
      </SectionTitle>
      {err && <p className="text-sm text-muted-foreground">{t({ ja: "読み込めませんでした", en: "Could not load", zh: "无法加载" })}（{err}）</p>}

      <h3 className="mb-3 text-lg">{t({ ja: "判定の定義", en: "What each result means", zh: "判定的定义" })}</h3>
      <div className="mb-10 rounded-xl border bg-card/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t({ ja: "判定", en: "Result", zh: "判定" })}</TableHead>
              <TableHead>{t({ ja: "定義", en: "Definition", zh: "定义" })}</TableHead>
              <TableHead className="text-right">{t({ ja: "件数", en: "Count", zh: "数量" })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(d?.categories ?? []).map((c) => (
              <TableRow key={c.key} className="cursor-pointer" onClick={() => setCat(cat === c.key ? "" : c.key)}>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={TONE[c.key] ?? "outline"}>{pick(c, lang)}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{defOf(c, lang)}</TableCell>
                <TableCell className="text-right tabular-nums">{d?.last_run ? c.count : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <h3 className="mb-3 text-lg">
        {t({ ja: "エンドポイントごとの結果", en: "Results per endpoint", zh: "各端点的结果" })}{" "}
        {cat && (
          <button className="ml-2 text-sm text-muted-foreground underline" onClick={() => setCat("")}>
            {t({ ja: "（絞り込みを解除）", en: "(clear filter)", zh: "（清除筛选）" })}
          </button>
        )}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t({ ja: "最終購入：", en: "Last purchase: ", zh: "最近购买：" })}
        {d?.last_run ? d.last_run.slice(0, 16).replace("T", " ") + " UTC" : t({ ja: "まだ購入していません", en: "none yet", zh: "尚未购买" })}
        {t({
          ja: "。行を開くと、送った要求（支払いヘッダ・署名は載せません）、ステータス、本文の SHA-256、送金 tx、確認の結果が見られます。",
          en: ". Open a row for the request sent (payment headers and signatures are never shown), the status, the body's SHA-256, the transfer tx and the checks.",
          zh: "。展开一行可查看所发送的请求（不显示付款头和签名）、状态码、正文的 SHA-256、转账 tx 和检查结果。",
        })}
      </p>
      <div className="mb-10 space-y-2">
        {items.map((i) => (
          <details key={i.id} className="rounded-lg border bg-card/60 px-4 py-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
              <Badge variant={TONE[i.last?.category ?? ""] ?? "outline"}>{categoryLabel(d?.categories, i.last?.category, lang, notBought)}</Badge>
              <span className="font-medium">{i.host}</span>
              <span className="break-all text-sm text-muted-foreground">
                {i.last?.request?.method ?? ""} {new URL(i.url).pathname}
              </span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                tx {i.reasons.endpoint_calls_30d ?? i.reasons.operator_tx ?? "—"} · buyers {i.reasons.endpoint_payers_30d ?? i.reasons.operator_buyers ?? "—"} · ${i.price_usd ?? "—"}
              </span>
            </summary>
            <EndpointDetail i={i} />
          </details>
        ))}
      </div>

      {d?.curation && (
        <>
          <h3 className="mb-3 text-lg">{t({ ja: "選び方", en: "How the list is chosen", zh: "如何挑选" })}</h3>
          <div className="mb-10 rounded-xl border bg-card/60 p-5 text-sm">
            <p>
              {t({
                ja: `候補 ${d.curation.candidates.operators} 運営者・${d.curation.candidates.endpoints.toLocaleString()} エンドポイント → 残したのは ${d.curation.kept} エンドポイント（${d.curation.operators_kept} 運営者）。選び直し：${d.curation.generated_at.slice(0, 10)}`,
                en: `Candidates: ${d.curation.candidates.operators} sellers, ${d.curation.candidates.endpoints.toLocaleString()} endpoints → kept ${d.curation.kept} endpoints (${d.curation.operators_kept} sellers). Chosen on ${d.curation.generated_at.slice(0, 10)}`,
                zh: `候选：${d.curation.candidates.operators} 个卖家、${d.curation.candidates.endpoints.toLocaleString()} 个端点 → 保留 ${d.curation.kept} 个端点（${d.curation.operators_kept} 个卖家）。重选日期：${d.curation.generated_at.slice(0, 10)}`,
              })}
            </p>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {(d.curation.rules_i18n?.[lang] ?? d.curation.rules).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-3">
              {t({ ja: "除外の理由と件数：", en: "Excluded, by reason: ", zh: "排除原因与数量：" })}
              {d.curation.excluded_by_reason.map((e) => `${pick(e, lang)} ${e.count}`).join(slash)}
            </p>
            <p className="mt-2 text-muted-foreground">
              {t({ ja: "除外した運営者：", en: "Sellers excluded: ", zh: "被排除的卖家：" })}
              {d.curation.excluded_operators.map((e) => `${e.host}（${reasonLabel(e.reason_key, e.reason)}）`).join(lang === "en" ? ", " : "、")}
            </p>
          </div>
        </>
      )}

      {!!d?.legacy_not_delivered.length && (
        <>
          <h3 className="mb-3 text-lg">
            {t({ ja: "以前の「払ったのに届かない」の読み直し", en: "Earlier “paid but not delivered”, re-read", zh: "重新解读以前的“付了款却未送达”" })}
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {t({
              ja: "2026-11-07 までは入力なしの GET だけで買っていました。その時の「払ったのに届かない」を、記録はそのままに上の判定で読み直したものです（Probe 側の誤りとして除外済みのもの〔テンプレート URL〕は含みません）。",
              en: "Until 2026-11-07 the Probe bought only with a bare GET. These are the “paid but not delivered” purchases from that time, re-read with the results above while the records stay as they are (purchases already excluded as the Probe's own mistake, template URLs, are left out).",
              zh: "2026-11-07 之前只用无输入的 GET 购买。这里在不改动记录的前提下，用上面的判定重新解读当时“付了款却未送达”的购买（已作为 Probe 自身错误排除的模板 URL 不包括在内）。",
            })}
          </p>
          <div className="mb-10 space-y-2">
            {d.legacy_not_delivered.map((g) => (
              <details key={g.date} className="rounded-lg border bg-card/60 px-4 py-3">
                <summary className="cursor-pointer">
                  {g.date}
                  {lang === "en" ? ": " : "："}
                  {g.not_delivered}
                  {t({ ja: " 件", en: "", zh: " 次" })} → {g.by_category.map((c) => `${categoryLabel(d.categories, c.key, lang, c.label)} ${c.count}`).join(slash)}
                </summary>
                <ul className="mt-2 text-xs text-muted-foreground">
                  {g.rows.map((r) => (
                    <li key={r.url}>
                      {r.host} — HTTP {String(r.http_status ?? "—")} — {categoryLabel(d.categories, r.category_key, lang, r.category)}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}

      {!!d?.own_sellers.length && (
        <>
          <h3 className="mb-3 text-lg">{t({ ja: "自社の売り手（JIN・OSD）", en: "Our own sellers (JIN, OSD)", zh: "我们自己的卖家（JIN・OSD）" })}</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {t({
              ja: "本サイト運営者の売り手です。上の一覧とは分けて、自己点検（再送・キャッシュの試験を含む）の最新の購入を載せています。スコアには入れていません。",
              en: "Sellers run by this site's operator, kept apart from the list above: the latest purchase from the self-check (which also runs replay and cache tests). Not part of any score.",
              zh: "本站运营者自己的卖家，与上面的列表分开，列出自检（包括重放和缓存测试）的最近一次购买。不计入评分。",
            })}
          </p>
          <div className="rounded-xl border bg-card/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t({ ja: "売り手", en: "Seller", zh: "卖家" })}</TableHead>
                  <TableHead>{t({ ja: "判定", en: "Result", zh: "判定" })}</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>tx</TableHead>
                  <TableHead>{t({ ja: "レシート", en: "Receipt", zh: "收据" })}</TableHead>
                  <TableHead>{t({ ja: "日付", en: "Date", zh: "日期" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.own_sellers.map((o) => (
                  <TableRow key={o.host}>
                    <TableCell>
                      {o.target} <span className="text-xs text-muted-foreground">{o.url}</span>
                    </TableCell>
                    <TableCell>{o.category ? categoryLabel(d.categories, o.category_key, lang, o.category) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{o.http_status ?? "—"}</TableCell>
                    <TableCell>
                      {o.tx ? (
                        <a className="underline" href={txLink(o.chain, o.tx)} target="_blank" rel="noreferrer">
                          {short(o.tx)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {o.receipt_ok === true ? t({ ja: "検証 ✓", en: "verified ✓", zh: "验证 ✓" }) : o.receipt_ok === false ? "✗" : "—"}
                    </TableCell>
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

/** One endpoint's purchase: why it was chosen, the request sent, the response and the checks. */
export function EndpointDetail({ i }: { i: Item }) {
  const { t, lang } = useLang();
  const r = i.reasons;
  return (
    <div className="mt-3 space-y-2 text-sm">
      <p className="text-muted-foreground">
        {t({
          ja: `選んだ理由：${r.listed_in.join(", ")}（運営者 tx ${r.operator_tx ?? "—"}・buyer ${r.operator_buyers ?? "—"}、${r.operator_stats_source}）／エンドポイント 30日 ${r.endpoint_calls_30d ?? "—"} 回・${r.endpoint_payers_30d ?? "—"} 人（${r.endpoint_stats_source}）`,
          en: `Why chosen: ${r.listed_in.join(", ")} (seller tx ${r.operator_tx ?? "—"}, buyers ${r.operator_buyers ?? "—"}; ${r.operator_stats_source}) / endpoint, 30 days: ${r.endpoint_calls_30d ?? "—"} calls, ${r.endpoint_payers_30d ?? "—"} payers (${r.endpoint_stats_source})`,
          zh: `选择原因：${r.listed_in.join(", ")}（卖家 tx ${r.operator_tx ?? "—"}、买家 ${r.operator_buyers ?? "—"}；${r.operator_stats_source}）／端点 30 天：${r.endpoint_calls_30d ?? "—"} 次调用、${r.endpoint_payers_30d ?? "—"} 个付款方（${r.endpoint_stats_source}）`,
        })}
      </p>
      {i.last ? (
        <>
          {i.last.reason && (
            <p>
              {t({ ja: "判定の根拠：", en: "Basis: ", zh: "判定依据：" })}
              {i.last.reason}
            </p>
          )}
          {i.last.request && (
            <div>
              <p>
                {t({ ja: "要求（出どころ：", en: "Request (from ", zh: "请求（来源：" })}
                {i.last.request.source} — {i.last.request.source_detail}
                {t({ ja: "）", en: ")", zh: "）" })}
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs">{`${i.last.request.method} ${i.last.request.url}${i.last.request.body !== null ? `\n${JSON.stringify(i.last.request.body, null, 1)}` : ""}`}</pre>
              <p className="text-xs text-muted-foreground">
                {t({ ja: "値：", en: "Values: ", zh: "取值：" })}
                {i.last.request.values.map((v) => `${v.name}=${JSON.stringify(v.value)}（${v.from}）`).join(lang === "en" ? ", " : "、") ||
                  t({ ja: "なし", en: "none", zh: "无" })}
              </p>
            </div>
          )}
          {i.last.request_tried && (
            <p className="text-xs text-muted-foreground">
              {t({ ja: "探した順：", en: "Looked up in order: ", zh: "查找顺序：" })}
              {i.last.request_tried.join(" ／ ")}
            </p>
          )}
          <p className="tabular-nums">
            HTTP {i.last.http_status ?? "—"} · {i.last.response_bytes ?? 0} bytes
            {i.last.response_sha256 && (
              <>
                {" "}
                · SHA-256 <code className="text-xs">{short(i.last.response_sha256, 12)}</code>
              </>
            )}
            {i.last.tx && (
              <>
                {" "}
                · tx{" "}
                <a className="underline" href={txLink(i.last.chain, i.last.tx)} target="_blank" rel="noreferrer">
                  {short(i.last.tx)}
                </a>
              </>
            )}
          </p>
          {i.last.checks && (
            <ul className="text-xs">
              {i.last.checks.map((c) => (
                <li key={c.name}>
                  {c.result === "pass" ? "✓" : c.result === "fail" ? "✗" : "–"} {c.name}
                  {lang === "en" ? ": " : "："}
                  {c.detail}
                </li>
              ))}
            </ul>
          )}
          {(i.last.body_head || i.last.error_body) && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{i.last.body_head ?? i.last.error_body}</pre>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">{t({ ja: "まだ購入していません。", en: "Not bought yet.", zh: "尚未购买。" })}</p>
      )}
    </div>
  );
}
