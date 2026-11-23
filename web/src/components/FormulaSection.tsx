import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ITEM_LABELS, type Weights } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";

export function FormulaSection({ w }: { w: Weights | null }) {
  const { t, lang } = useLang();
  const free = t({ ja: "無料", en: "Free", zh: "免费" });
  const paid = t({ ja: "有料", en: "Paid", zh: "付费" });
  const rows = w ? [...Object.entries(w.free).map(([k, v]) => [k, free, v] as const), ...Object.entries(w.paid).map(([k, v]) => [k, paid, v] as const)] : [];
  const days = w?.window_days ?? 30;
  const lat = w
    ? t({
        ja: `${w.latency_ms.full_marks_at_or_below} ms 以下を 1、${w.latency_ms.zero_at_or_above} ms 以上を 0`,
        en: `${w.latency_ms.full_marks_at_or_below} ms or less as 1 and ${w.latency_ms.zero_at_or_above} ms or more as 0`,
        zh: `${w.latency_ms.full_marks_at_or_below} ms 以内记为 1，${w.latency_ms.zero_at_or_above} ms 以上记为 0`,
      })
    : "—";
  const c = (s: string) => <code className="text-foreground">{s}</code>;
  return (
    <section id="formula" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="Formula" title="How a score is computed">
        <p>
          {t({
            ja: `ホストごとに直近 ${days} 日の測定から項目ごとの合格率（0〜1）を出し、重み付き平均を 100 倍します。`,
            en: `For each host, the pass rate of each item (0–1) over the last ${days} days of measurements is weighted, averaged and multiplied by 100.`,
            zh: `对每个主机，根据最近 ${days} 天的测量求出各项的通过率（0–1），取加权平均后乘以 100。`,
          })}
        </p>
      </SectionTitle>
      <pre className="mb-8 overflow-x-auto rounded-xl border bg-card/60 p-5 text-sm">
        {t({
          ja: "score = 100 × Σ(重み × 合格率) ÷ Σ(重み)    ※ 観測のない項目は分子・分母から除く",
          en: "score = 100 × Σ(weight × pass rate) ÷ Σ(weight)    * items with no observation are left out of both",
          zh: "score = 100 × Σ(权重 × 通过率) ÷ Σ(权重)    ※ 无观测的项目不计入分子和分母",
        })}
      </pre>
      <div className="grid gap-10 lg:grid-cols-2">
        <ul className="list-disc space-y-3 pl-5 leading-relaxed text-muted-foreground">
          <li>
            {t({
              ja: "前段で失敗した項目は後段も不合格として数えます（応答なし → 402 なし → 形式・asset も不合格）。",
              en: "When an earlier step fails, the later ones count as failed too (no response → no 402 → format and asset fail).",
              zh: "前一步失败时，后续项目也计为不通过（无响应 → 无 402 → 格式与 asset 也不通过）。",
            })}
          </li>
          <li>
            {lang === "ja" && <>{c("payto_stable")} は前回の測定と比べられるときだけ数えます（初回は数えない）。</>}
            {lang === "en" && <>{c("payto_stable")} counts only when there is an earlier measurement to compare with (not the first time).</>}
            {lang === "zh" && <>{c("payto_stable")} 仅在可与上次测量比较时计入（首次不计）。</>}
          </li>
          <li>
            {lang === "ja" && <>応答時間は 1 回ごとに、{lat} として線形に換算します。{c("latency_paid")} は納品できた回だけ数えます。</>}
            {lang === "en" && <>Each response time is scaled linearly, {lat}. {c("latency_paid")} counts only purchases that were delivered.</>}
            {lang === "zh" && <>每次的响应时间按线性换算：{lat}。{c("latency_paid")} 只计入成功交付的那几次。</>}
          </li>
          <li>
            {lang === "ja" && <>{c("not_delivered")} は悪い結果なので {c("1 − 発生率")} で数えます。</>}
            {lang === "en" && <>{c("not_delivered")} is a bad outcome, so it counts as {c("1 − rate")}.</>}
            {lang === "zh" && <>{c("not_delivered")} 是不良结果，因此按 {c("1 − 发生率")} 计算。</>}
          </li>
          <li>
            {t({
              ja: "有料の測定がないホストは無料の項目だけで計算し、free_only と表示します。",
              en: "Hosts without a paid measurement are scored on the free items only and marked free_only.",
              zh: "没有付费测量的主机只按免费项目计算，并标记为 free_only。",
            })}
          </li>
          <li>
            {t({
              ja: "dry-run（署名のみで送信しない確認）の記録はスコアにも使用額にも入りません。",
              en: "Dry runs (signed, never sent) count toward neither the score nor the spend.",
              zh: "dry-run（只签名不发送的检查）的记录不计入评分，也不计入支出。",
            })}
          </li>
        </ul>
        <div className="rounded-xl border bg-card/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t({ ja: "項目", en: "Item", zh: "项目" })}</TableHead>
                <TableHead>{t({ ja: "種別", en: "Type", zh: "类型" })}</TableHead>
                <TableHead className="text-right">{t({ ja: "重み", en: "Weight", zh: "权重" })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([k, kind, v]) => (
                <TableRow key={k}>
                  <TableCell className="whitespace-normal">
                    <code className="text-xs">{k}</code>
                    <div className="text-xs text-muted-foreground">{ITEM_LABELS[k] ? t(ITEM_LABELS[k]) : ""}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{kind}</TableCell>
                  <TableCell className="text-right tabular-nums">{v}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      {w && (
        <p className="mt-6 text-sm text-muted-foreground">
          {t({ ja: "重みの変更履歴：", en: "Weight history: ", zh: "权重变更记录：" })}
          {w.history
            .map((h) => `v${h.version}（${h.date}）${lang === "en" ? (h.change_en ?? h.change) : lang === "zh" ? (h.change_zh ?? h.change) : h.change}`)
            .join(" / ")}
        </p>
      )}
    </section>
  );
}
