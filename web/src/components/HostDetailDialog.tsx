import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type HostDetail, ITEM_LABELS, getJson, networkName, scoreTone, usd } from "@/lib/data";
import { type L, useLang } from "@/lib/i18n";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Block explorer link for a purchase's payment tx, so anyone can check it. */
function explorer(r: Record<string, unknown>): string | null {
  const tx = typeof r.tx === "string" ? r.tx : null;
  if (!tx) return null;
  const net = String(r.network ?? r.chain ?? "");
  if (net.startsWith("eip155:8453") || net === "base" || tx.startsWith("0x")) return `https://basescan.org/tx/${tx}`;
  return `https://solscan.io/tx/${tx}`;
}

const atomicUsd = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? `$${Number(v) / 1e6}` : "—");

function outcome(r: Record<string, unknown>, t: (s: L) => string): string {
  const why = (r.x402_error ?? r.error_body) as string | undefined;
  const w = why ? `（${why}）` : "";
  const s = String(r.http_status ?? "—");
  if (r.kind === "free")
    return r.status_402
      ? `402 ${r.spec_version ?? ""}`
      : r.reachable
        ? `HTTP ${r.http_status}`
        : t({ ja: "応答なし", en: "No response", zh: "无响应" }) + (r.error ? `（${r.error}）` : "");
  if (r.dry_run) return t({ ja: "dry-run（送信なし）", en: "dry run (not sent)", zh: "dry-run（未发送）" });
  if (r.skipped) return t({ ja: "購入せず：", en: "Not bought: ", zh: "未购买：" }) + String(r.skipped);
  switch (r.outcome) {
    case "delivered":
      return t({ ja: "納品（送金あり・200）", en: "Delivered (transfer, 200)", zh: "已交付（已转账，200）" });
    case "not_delivered":
      return t({ ja: `未納品：送金後に HTTP ${s}`, en: `Not delivered: HTTP ${s} after the transfer`, zh: `未交付：转账后返回 HTTP ${s}` }) + w;
    case "invalid_target":
      return t({ ja: "Probe 側の測定の誤り（集計に入れない）", en: "The Probe's own mistake (not counted)", zh: "Probe 自身的测量错误（不计入统计）" });
    case "overcharged":
      return t({
        ja: "過大請求：チェーン上の送金が 402 の提示額を超えた（未納品と同じ扱い）",
        en: "Overcharged: the on-chain transfer exceeded the 402 offer (treated as not delivered)",
        zh: "多收费：链上转账超过了 402 的报价（按未交付处理）",
      });
    case "delivered_unsettled":
      return t({
        ja: "送金なしで納品：200 と本文が返ったが、決済ヘッダもチェーン上の送金もない",
        en: "Delivered without payment: 200 with a body, but no settlement header and no on-chain transfer",
        zh: "未付款即交付：返回了 200 和正文，但没有结算头也没有链上转账",
      });
    case "request_rejected":
      return (
        t({ ja: `購入不成立：送金なしで HTTP ${s}`, en: `Not completed: HTTP ${s} with no transfer`, zh: `购买未成立：未转账，HTTP ${s}` }) +
        (why ? w : t({ ja: "（理由は未記録）", en: " (reason not recorded)", zh: "（原因未记录）" }))
      );
    default:
      return t({ ja: `失敗：HTTP ${s}`, en: `Failed: HTTP ${s}`, zh: `失败：HTTP ${s}` }) + (r.error ? `（${r.error}）` : "");
  }
}

export function HostDetailDialog({ host, onClose }: { host: string | null; onClose: () => void }) {
  const { t } = useLang();
  const [d, setD] = useState<HostDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!host) return;
    setD(null);
    setErr(null);
    getJson<HostDetail>(`/scores/${encodeURIComponent(host)}`).then(setD, (e) => setErr(String(e?.message ?? e)));
  }, [host]);

  return (
    <Dialog open={!!host} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle style={{ fontFamily: "'Instrument Serif', serif" }}>{host}</DialogTitle>
        <DialogDescription>
          {d
            ? t({ ja: `直近の測定 無料 ${d.n_free} 回・有料 ${d.n_paid} 回`, en: `Recent measurements: ${d.n_free} free, ${d.n_paid} paid`, zh: `最近的测量：免费 ${d.n_free} 次，付费 ${d.n_paid} 次` })
            : err
              ? t({ ja: "読み込めませんでした", en: "Could not load", zh: "无法加载" }) + `（${err}）`
              : t({ ja: "読み込み中…", en: "Loading…", zh: "加载中…" })}
        </DialogDescription>
        {d && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-baseline gap-4">
              <span className={`text-5xl ${scoreTone(d.score)}`} style={{ fontFamily: "'Instrument Serif', serif" }}>
                {d.score ?? "—"}
              </span>
              <Badge variant={d.coverage === "full" ? "accent" : "outline"}>{d.coverage}</Badge>
              {d.receipt?.advertised && (
                <Badge variant="outline" className="ml-1">
                  {t({ ja: "Delivery Receipt 対応", en: "Delivery Receipt", zh: "支持 Delivery Receipt" })}
                  {d.receipt.ok === true
                    ? t({ ja: "・検証 OK", en: " · verified", zh: "・验证通过" })
                    : d.receipt.ok === false
                      ? t({ ja: "・検証 NG", en: " · failed", zh: "・验证失败" }) + `（${d.receipt.reason ?? ""}）`
                      : ""}
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {networkName(d.latest.network)} · {usd(d.latest.amount)} · {d.latest.spec_version ?? "—"}
              </span>
            </div>
            {d.latest.url && <p className="break-all text-xs text-muted-foreground">{d.latest.url}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t({ ja: "項目", en: "Item", zh: "项目" })}</TableHead>
                  <TableHead className="text-right">{t({ ja: "合格率", en: "Pass rate", zh: "通过率" })}</TableHead>
                  <TableHead className="text-right">{t({ ja: "観測", en: "Observed", zh: "观测" })}</TableHead>
                  <TableHead className="text-right">{t({ ja: "重み", en: "Weight", zh: "权重" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(d.items).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="whitespace-normal">
                      <code className="text-xs">{k}</code>
                      <div className="text-xs text-muted-foreground">{ITEM_LABELS[k] ? t(ITEM_LABELS[k]) : ""}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(v.value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.n}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.weight}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t({ ja: "直近の測定", en: "Recent measurements", zh: "最近的测量" })}</p>
              <ul className="space-y-1 text-sm">
                {d.history.slice(0, 12).map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 tabular-nums text-muted-foreground">{String(r.ts).slice(0, 16).replace("T", " ")}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {r.kind === "free" ? t({ ja: "無料", en: "Free", zh: "免费" }) : t({ ja: "有料", en: "Paid", zh: "付费" })}
                    </span>
                    <span className="min-w-0 break-words">
                      {outcome(r, t)}
                      {r.kind === "paid" && (explorer(r) || r.response_sha256 || r.price_mismatch) ? (
                        <span className="block text-xs text-muted-foreground">
                          {explorer(r) && (
                            <a className="underline underline-offset-4" href={explorer(r)!} target="_blank" rel="noreferrer">
                              tx {String(r.tx).slice(0, 10)}…
                            </a>
                          )}
                          {r.response_sha256 ? (
                            <span className="ml-2 break-all">
                              {t({ ja: "本文 SHA-256", en: "Body SHA-256", zh: "正文 SHA-256" })} {String(r.response_sha256).slice(0, 16)}…
                            </span>
                          ) : null}
                          {r.receipt ? (
                            <span className="ml-2">
                              {t({ ja: "レシートあり", en: "Receipt", zh: "有收据" })}
                              {r.receipt_ok === true
                                ? t({ ja: "（検証 OK）", en: " (verified)", zh: "（验证通过）" })
                                : r.receipt_ok === false
                                  ? t({ ja: "（検証 NG）", en: " (failed)", zh: "（验证失败）" })
                                  : ""}
                            </span>
                          ) : null}
                          {r.price_mismatch ? (
                            <span className="ml-2 text-bad">
                              {t({ ja: "価格の不一致：カタログ", en: "Price mismatch: catalog", zh: "价格不一致：目录" })} {atomicUsd((r.price_check as any)?.catalog)}・402{" "}
                              {atomicUsd((r.price_check as any)?.offered)}・{t({ ja: "送金", en: "transfer", zh: "转账" })} {atomicUsd((r.price_check as any)?.transferred)}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {(d.n_paid > 0 || d.n_rejected > 0 || d.n_unsettled > 0) && (
              <div className="rounded-lg border p-4 text-sm">
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t({ ja: "有料の測定の内訳", en: "Paid measurements", zh: "付费测量明细" })}</p>
                <p>
                  {t({
                    ja: `納品 ${d.paid_outcomes.delivered} ・ 未納品 ${d.paid_outcomes.not_delivered} ・ 過大請求 ${d.paid_outcomes.overcharged ?? 0} ・ 失敗 ${d.paid_outcomes.failed} ・ 価格の不一致 ${d.n_price_mismatch ?? 0}`,
                    en: `Delivered ${d.paid_outcomes.delivered} · not delivered ${d.paid_outcomes.not_delivered} · overcharged ${d.paid_outcomes.overcharged ?? 0} · failed ${d.paid_outcomes.failed} · price mismatch ${d.n_price_mismatch ?? 0}`,
                    zh: `已交付 ${d.paid_outcomes.delivered} ・ 未交付 ${d.paid_outcomes.not_delivered} ・ 多收费 ${d.paid_outcomes.overcharged ?? 0} ・ 失败 ${d.paid_outcomes.failed} ・ 价格不一致 ${d.n_price_mismatch ?? 0}`,
                  })}
                  <span className="text-muted-foreground">
                    {t({
                      ja: ` ／ 購入不成立 ${d.n_rejected} ・ 送金なしで納品 ${d.n_unsettled ?? 0}（どちらもスコアには数えない）`,
                      en: ` / not completed ${d.n_rejected} · delivered without payment ${d.n_unsettled ?? 0} (neither counts in the score)`,
                      zh: ` ／ 购买未成立 ${d.n_rejected} ・ 未付款即交付 ${d.n_unsettled ?? 0}（两者都不计入评分）`,
                    })}
                  </span>
                </p>
                {d.last_rejection && (
                  <p className="mt-2 break-words text-muted-foreground">
                    {t({
                      ja: `直近の購入不成立（${d.last_rejection.ts.slice(0, 10)}・HTTP ${d.last_rejection.http_status ?? "—"}）：`,
                      en: `Latest not completed (${d.last_rejection.ts.slice(0, 10)}, HTTP ${d.last_rejection.http_status ?? "—"}): `,
                      zh: `最近一次购买未成立（${d.last_rejection.ts.slice(0, 10)}，HTTP ${d.last_rejection.http_status ?? "—"}）：`,
                    })}
                    {d.last_rejection.error ??
                      t({ ja: "理由は未記録（記録を始める前の測定）", en: "reason not recorded (measured before reasons were kept)", zh: "原因未记录（开始记录之前的测量）" })}
                  </p>
                )}
              </div>
            )}
            {d.rfq && (
              <p className="text-sm text-muted-foreground">
                {t({
                  ja: `RFQ Market の成績（参考値・スコアには不使用）：成立 ${d.rfq.fulfilled} / 拒否 ${d.rfq.rejected} / 未納品 ${d.rfq.not_delivered}`,
                  en: `RFQ Market record (reference only, not in the score): filled ${d.rfq.fulfilled} / rejected ${d.rfq.rejected} / not delivered ${d.rfq.not_delivered}`,
                  zh: `RFQ Market 成绩（仅供参考，不计入评分）：成交 ${d.rfq.fulfilled} / 拒绝 ${d.rfq.rejected} / 未交付 ${d.rfq.not_delivered}`,
                })}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
