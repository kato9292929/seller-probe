import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Scores, networkName, scoreTone } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { HostDetailDialog } from "./HostDetailDialog";
import { SectionTitle } from "./SectionTitle";

const PAGE = 100;
const COVERAGE = [
  { v: "", label: { ja: "すべて", en: "All", zh: "全部" } },
  { v: "full", label: { ja: "有料の測定あり", en: "Paid measured", zh: "有付费测量" } },
  { v: "free_only", label: { ja: "無料の測定のみ", en: "Free only", zh: "仅免费测量" } },
] as const;

export function ScoresSection({ data, error }: { data: Scores | null; error: string | null }) {
  const { t, lang } = useLang();
  const [q, setQ] = useState("");
  const [cov, setCov] = useState<"" | "full" | "free_only">("");
  const [shown, setShown] = useState(PAGE);
  const [host, setHost] = useState<string | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.scores ?? []).filter((r) => (!s || r.host.includes(s)) && (!cov || r.coverage === cov));
  }, [data, q, cov]);
  const full = data?.scores.filter((s) => s.coverage === "full").length ?? 0;
  const filterLabel = t({ ja: "ホストで絞り込み", en: "Filter by host", zh: "按主机筛选" });

  return (
    <section id="scores" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="Scores" title="Seller scores">
        <p>
          {t({
            ja: "この測定は本サイト運営者（x402jp.com）の自社エージェントが行っています（支払いには Probe 専用のウォレットを使用）。第三者の売り手には、通常の買い手と同じ 1 回の閲覧と、最小額での 1 回の購入しか行いません。再送・キャッシュ・負荷の試験は自社の売り手にだけ行い、結果はスコアに入れていません。",
            en: "These measurements are made by the site operator's (x402jp.com) own agent, paying from a wallet used only by the Probe. Third-party sellers get only what an ordinary buyer does: one look and one purchase at the lowest price. Replay, cache and load tests are run only against our own sellers, and their results are not part of any score.",
            zh: "这些测量由本站运营者（x402jp.com）自己的代理进行（付款使用 Probe 专用钱包）。对第三方卖家，只做与普通买家相同的一次浏览和一次最低金额的购买。重放、缓存和负载测试只针对我们自己的卖家，其结果不计入评分。",
          })}
        </p>
      </SectionTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          { k: t({ ja: "測定ホスト", en: "Hosts measured", zh: "测量的主机" }), v: data ? data.hosts.toLocaleString() : "—" },
          { k: t({ ja: "有料の測定あり", en: "With paid measurement", zh: "有付费测量" }), v: data ? full.toLocaleString() : "—" },
          { k: t({ ja: "更新", en: "Updated", zh: "更新" }), v: data ? data.generated_at.slice(0, 16).replace("T", " ") + " UTC" : "—" },
        ].map((s) => (
          <div key={s.k} className="rounded-xl border bg-card/60 p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.k}</p>
            <p className="mt-2 text-3xl tabular-nums" style={{ fontFamily: "'Instrument Serif', serif" }}>
              {s.v}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          id="host-filter"
          className="sm:max-w-xs"
          type="search"
          placeholder={filterLabel}
          aria-label={filterLabel}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
          }}
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label={t({ ja: "測定範囲", en: "Coverage", zh: "测量范围" })}>
          {COVERAGE.map((c) => (
            <Button
              key={c.v}
              size="sm"
              variant={cov === c.v ? "default" : "outline"}
              className="rounded-full"
              onClick={() => {
                setCov(c.v);
                setShown(PAGE);
              }}
            >
              {t(c.label)}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead>{t({ ja: "ホスト", en: "Host", zh: "主机" })}</TableHead>
              <TableHead className="text-right">{t({ ja: "スコア", en: "Score", zh: "评分" })}</TableHead>
              <TableHead>{t({ ja: "範囲", en: "Coverage", zh: "范围" })}</TableHead>
              <TableHead className="text-right">{t({ ja: "無料 / 有料", en: "Free / Paid", zh: "免费 / 付费" })}</TableHead>
              <TableHead
                className="text-right"
                title={t({
                  ja: "送金なしで 4xx・402 が返り、購入が成立しなかった回数。スコアには数えない",
                  en: "Times a 4xx or 402 came back with no transfer, so no purchase happened. Not counted in the score",
                  zh: "未发生转账即返回 4xx 或 402、购买未成立的次数。不计入评分",
                })}
              >
                {t({ ja: "購入不成立", en: "Not completed", zh: "购买未成立" })}
              </TableHead>
              <TableHead>{t({ ja: "ネットワーク", en: "Network", zh: "网络" })}</TableHead>
              <TableHead>{t({ ja: "最終測定", en: "Last measured", zh: "最近测量" })}</TableHead>
              <TableHead
                title={t({
                  ja: "x402 RFQ Market の成績。参考値でありスコアには入っていません",
                  en: "Record on the x402 RFQ Market. For reference only; not part of the score",
                  zh: "在 x402 RFQ Market 上的成绩。仅供参考，不计入评分",
                })}
              >
                {t({ ja: "RFQ 参考", en: "RFQ (ref.)", zh: "RFQ 参考" })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.slice(0, shown).map((s, i) => (
              <TableRow key={s.host}>
                <TableCell className="text-right tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <button className="text-left underline-offset-4 hover:underline" onClick={() => setHost(s.host)}>
                    {s.host}
                  </button>
                </TableCell>
                <TableCell className={`text-right font-medium tabular-nums ${scoreTone(s.score)}`}>{s.score ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={s.coverage === "full" ? "accent" : "outline"}>{s.coverage}</Badge>
                  {s.receipt?.advertised && (
                    <Badge
                      variant="outline"
                      className="ml-1"
                      title={
                        s.receipt.ok === false
                          ? t({ ja: "レシートの検証に失敗：", en: "Receipt failed verification: ", zh: "收据验证失败：" }) + (s.receipt.reason ?? "")
                          : t({
                              ja: "Delivery Receipt 対応（/.well-known/x402-receipt.json）",
                              en: "Supports Delivery Receipt (/.well-known/x402-receipt.json)",
                              zh: "支持 Delivery Receipt（/.well-known/x402-receipt.json）",
                            })
                      }
                    >
                      Receipt{s.receipt.ok === true ? " ✓" : s.receipt.ok === false ? " ✗" : ""}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.n_free} / {s.n_paid}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground" title={s.last_rejection?.error ?? undefined}>
                  {s.n_rejected || "—"}
                </TableCell>
                <TableCell>{networkName(s.latest.network)}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{(s.last_paid_at ?? s.last_free_at ?? "").slice(0, 10)}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {s.rfq ? `${s.rfq.fulfilled} / ${s.rfq.rejected} / ${s.rfq.not_delivered}` : "—"}
                </TableCell>
              </TableRow>
            ))}
            {!list.length && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  {error
                    ? t({ ja: "スコアを読み込めませんでした", en: "Could not load the scores", zh: "无法加载评分" }) + `（${error}）`
                    : !data
                      ? t({ ja: "読み込み中…", en: "Loading…", zh: "加载中…" })
                      : data.scores.length
                        ? t({ ja: "条件に合うホストがありません。", en: "No host matches.", zh: "没有符合条件的主机。" })
                        : t({
                            ja: "まだ測定データがありません。最初の無料の測定（毎日 03:17 UTC）のあとに表示されます。",
                            en: "No measurements yet. They appear after the first free measurement (daily, 03:17 UTC).",
                            zh: "尚无测量数据。首次免费测量（每天 03:17 UTC）之后显示。",
                          })}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {list.length
            ? lang === "en"
              ? `${Math.min(shown, list.length).toLocaleString()} of ${list.length.toLocaleString()}`
              : `${Math.min(shown, list.length).toLocaleString()} / ${list.length.toLocaleString()} ${lang === "zh" ? "个" : "件"}`
            : ""}
        </span>
        {list.length > shown && (
          <button className="liquid-glass rounded-full px-6 py-2.5 text-foreground transition-transform hover:scale-[1.03]" onClick={() => setShown(shown + 500)}>
            {t({ ja: "さらに表示", en: "Show more", zh: "显示更多" })}
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {t({
          ja: "購入不成立は、支払いを送ったのに送金されないまま 4xx・402 が返った回数です（入力不足などで購入自体が成立しなかったもの）。納品の成否には数えていません。200 と本文が返ったのに決済も送金もなかった回（送金なしで納品）も、失敗に数えず各ホストの詳細に別に出します。",
          en: "“Not completed” counts purchases where a payment was sent but a 4xx or 402 came back with no transfer (for example, missing input), so no purchase happened. These are not counted as delivered or not delivered. A 200 with a body but no settlement or transfer (delivered without payment) is not counted as a failure either; it is shown separately in each host's detail.",
          zh: "“购买未成立”是指已发送付款但未发生转账、并返回 4xx 或 402 的次数（例如输入不足导致购买本身未成立）。不计入交付成败。返回了 200 和正文却没有结算和转账的情况（未付款即交付）也不算失败，在各主机详情中单独显示。",
        })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t({
          ja: "RFQ 参考は x402 RFQ Market での成立 / 拒否 / 未納品の件数です。参考値で、スコアの計算には入れていません。",
          en: "RFQ (ref.) is the number of filled / rejected / not delivered on the x402 RFQ Market. For reference only; not used in the score.",
          zh: "RFQ 参考是在 x402 RFQ Market 上成交 / 拒绝 / 未交付的次数。仅供参考，不计入评分。",
        })}
      </p>
      {data?.price_mismatch && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t({
            ja: `価格の不一致（カタログ・402 の提示・チェーン上の送金のどれかが違った購入）：${data.price_mismatch.purchases} 件・${data.price_mismatch.hosts} ホスト。送金が提示を超えたもの（過大請求）は未納品と同じ重さの失敗に数えます。`,
            en: `Price mismatches (purchases where the catalog, the 402 offer and the on-chain transfer disagreed): ${data.price_mismatch.purchases} purchases on ${data.price_mismatch.hosts} hosts. A transfer above the offer (overcharge) counts as a failure as heavy as not delivered.`,
            zh: `价格不一致（目录、402 报价与链上转账三者有不同的购买）：${data.price_mismatch.purchases} 次，${data.price_mismatch.hosts} 个主机。转账超过报价（多收费）按与未交付同等严重的失败计算。`,
          })}
        </p>
      )}
      {data?.reports && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t({
            ja: `買い手からの報告（@x402jp/safe-buy、匿名）：${data.reports.received} 件・${data.reports.hosts} ホスト。Probe 自身の測定とは別に数え、スコアには入れていません。`,
            en: `Reports from buyers (@x402jp/safe-buy, anonymous): ${data.reports.received} on ${data.reports.hosts} hosts. Counted apart from the Probe's own measurements and not used in the score.`,
            zh: `来自买家的报告（@x402jp/safe-buy，匿名）：${data.reports.received} 条，${data.reports.hosts} 个主机。与 Probe 自身的测量分开统计，不计入评分。`,
          })}
        </p>
      )}
      <HostDetailDialog host={host} onClose={() => setHost(null)} />
    </section>
  );
}
