import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type HostDetail, ITEM_LABELS, getJson, networkName, scoreTone, usd } from "@/lib/data";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function outcome(r: Record<string, unknown>): string {
  if (r.kind === "free") return r.status_402 ? `402 ${r.spec_version ?? ""}` : r.reachable ? `HTTP ${r.http_status}` : `応答なし${r.error ? `（${r.error}）` : ""}`;
  if (r.dry_run) return "dry-run（送信なし）";
  if (r.skipped) return `購入せず：${r.skipped}`;
  const why = (r.x402_error ?? r.error_body) as string | undefined;
  switch (r.outcome) {
    case "delivered":
      return "納品（送金あり・200）";
    case "not_delivered":
      return `未納品：送金後に HTTP ${r.http_status}${why ? `（${why}）` : ""}`;
    case "request_rejected":
      return `購入不成立：送金なしで HTTP ${r.http_status}${why ? `（${why}）` : "（理由は未記録）"}`;
    default:
      return `失敗：HTTP ${r.http_status ?? "—"}${r.error ? `（${r.error}）` : ""}`;
  }
}

export function HostDetailDialog({ host, onClose }: { host: string | null; onClose: () => void }) {
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
          {d ? `直近の測定 無料 ${d.n_free} 回・有料 ${d.n_paid} 回` : err ? `読み込めませんでした（${err}）` : "読み込み中…"}
        </DialogDescription>
        {d && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-baseline gap-4">
              <span className={`text-5xl ${scoreTone(d.score)}`} style={{ fontFamily: "'Instrument Serif', serif" }}>
                {d.score ?? "—"}
              </span>
              <Badge variant={d.coverage === "full" ? "accent" : "outline"}>{d.coverage}</Badge>
              <span className="text-sm text-muted-foreground">
                {networkName(d.latest.network)} · {usd(d.latest.amount)} · {d.latest.spec_version ?? "—"}
              </span>
            </div>
            {d.latest.url && <p className="break-all text-xs text-muted-foreground">{d.latest.url}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>項目</TableHead>
                  <TableHead className="text-right">合格率</TableHead>
                  <TableHead className="text-right">観測</TableHead>
                  <TableHead className="text-right">重み</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(d.items).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="whitespace-normal">
                      <code className="text-xs">{k}</code>
                      <div className="text-xs text-muted-foreground">{ITEM_LABELS[k]}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(v.value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.n}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.weight}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">直近の測定</p>
              <ul className="space-y-1 text-sm">
                {d.history.slice(0, 12).map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 tabular-nums text-muted-foreground">{String(r.ts).slice(0, 16).replace("T", " ")}</span>
                    <span className="shrink-0 text-muted-foreground">{r.kind === "free" ? "無料" : "有料"}</span>
                    <span className="min-w-0 break-words">{outcome(r)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {(d.n_paid > 0 || d.n_rejected > 0) && (
              <div className="rounded-lg border p-4 text-sm">
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">有料の測定の内訳</p>
                <p>
                  納品 {d.paid_outcomes.delivered} ・ 未納品 {d.paid_outcomes.not_delivered} ・ 失敗 {d.paid_outcomes.failed}
                  <span className="text-muted-foreground"> ／ 購入不成立 {d.n_rejected}（スコアには数えない）</span>
                </p>
                {d.last_rejection && (
                  <p className="mt-2 break-words text-muted-foreground">
                    直近の購入不成立（{d.last_rejection.ts.slice(0, 10)}・HTTP {d.last_rejection.http_status ?? "—"}）：
                    {d.last_rejection.error ?? "理由は未記録（記録を始める前の測定）"}
                  </p>
                )}
              </div>
            )}
            {d.rfq && (
              <p className="text-sm text-muted-foreground">
                RFQ Market の成績（参考値・スコアには不使用）：成立 {d.rfq.fulfilled} / 拒否 {d.rfq.rejected} / 未納品 {d.rfq.not_delivered}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
