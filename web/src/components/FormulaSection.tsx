import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ITEM_LABELS, type Weights } from "@/lib/data";
import { SectionTitle } from "./SectionTitle";

export function FormulaSection({ w }: { w: Weights | null }) {
  const rows = w ? [...Object.entries(w.free).map(([k, v]) => [k, "無料", v] as const), ...Object.entries(w.paid).map(([k, v]) => [k, "有料", v] as const)] : [];
  return (
    <section id="formula" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="Formula" title="How a score is computed">
        <p>ホストごとに直近 {w?.window_days ?? 30} 日の測定から項目ごとの合格率（0〜1）を出し、重み付き平均を 100 倍します。</p>
      </SectionTitle>
      <pre className="mb-8 overflow-x-auto rounded-xl border bg-card/60 p-5 text-sm">
        score = 100 × Σ(重み × 合格率) ÷ Σ(重み)    ※ 観測のない項目は分子・分母から除く
      </pre>
      <div className="grid gap-10 lg:grid-cols-2">
        <ul className="list-disc space-y-3 pl-5 leading-relaxed text-muted-foreground">
          <li>前段で失敗した項目は後段も不合格として数えます（応答なし → 402 なし → 形式・asset も不合格）。</li>
          <li>
            <code className="text-foreground">payto_stable</code> は前回の測定と比べられるときだけ数えます（初回は数えない）。
          </li>
          <li>
            応答時間は 1 回ごとに、{w ? `${w.latency_ms.full_marks_at_or_below} ms 以下を 1、${w.latency_ms.zero_at_or_above} ms 以上を 0` : "—"}{" "}
            として線形に換算します。<code className="text-foreground">latency_paid</code> は納品できた回だけ数えます。
          </li>
          <li>
            <code className="text-foreground">not_delivered</code> は悪い結果なので <code className="text-foreground">1 − 発生率</code> で数えます。
          </li>
          <li>有料の測定がないホストは無料の項目だけで計算し、free_only と表示します。</li>
          <li>dry-run（署名のみで送信しない確認）の記録はスコアにも使用額にも入りません。</li>
        </ul>
        <div className="rounded-xl border bg-card/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>項目</TableHead>
                <TableHead>種別</TableHead>
                <TableHead className="text-right">重み</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([k, t, v]) => (
                <TableRow key={k}>
                  <TableCell className="whitespace-normal">
                    <code className="text-xs">{k}</code>
                    <div className="text-xs text-muted-foreground">{ITEM_LABELS[k]}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t}</TableCell>
                  <TableCell className="text-right tabular-nums">{v}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      {w && (
        <p className="mt-6 text-sm text-muted-foreground">
          重みの変更履歴：{w.history.map((h) => `v${h.version}（${h.date}）${h.change}`).join(" / ")}
        </p>
      )}
    </section>
  );
}
