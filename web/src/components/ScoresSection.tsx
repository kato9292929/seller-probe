import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Scores, networkName, scoreTone } from "@/lib/data";
import { HostDetailDialog } from "./HostDetailDialog";
import { SectionTitle } from "./SectionTitle";

const PAGE = 100;
const COVERAGE = [
  { v: "", label: "すべて" },
  { v: "full", label: "有料の測定あり" },
  { v: "free_only", label: "無料の測定のみ" },
] as const;

export function ScoresSection({ data, error }: { data: Scores | null; error: string | null }) {
  const [q, setQ] = useState("");
  const [cov, setCov] = useState<"" | "full" | "free_only">("");
  const [shown, setShown] = useState(PAGE);
  const [host, setHost] = useState<string | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.scores ?? []).filter((r) => (!s || r.host.includes(s)) && (!cov || r.coverage === cov));
  }, [data, q, cov]);
  const full = data?.scores.filter((s) => s.coverage === "full").length ?? 0;

  return (
    <section id="scores" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="Scores" title="Seller scores">
        <p>
          この測定は本サイト運営者（x402jp.com）の自社エージェントが行っています（支払いには Probe 専用のウォレットを使用）。
          第三者の売り手には、通常の買い手と同じ 1 回の閲覧と、最小額での 1 回の購入しか行いません。再送・キャッシュ・負荷の試験は自社の売り手にだけ行い、結果はスコアに入れていません。
        </p>
      </SectionTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          { k: "測定ホスト", v: data ? data.hosts.toLocaleString() : "—" },
          { k: "有料の測定あり", v: data ? full.toLocaleString() : "—" },
          { k: "更新", v: data ? data.generated_at.slice(0, 16).replace("T", " ") + " UTC" : "—" },
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
          className="sm:max-w-xs"
          type="search"
          placeholder="ホストで絞り込み"
          aria-label="ホストで絞り込み"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
          }}
        />
        <div className="flex gap-2" role="group" aria-label="測定範囲">
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
              {c.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead>ホスト</TableHead>
              <TableHead className="text-right">スコア</TableHead>
              <TableHead>範囲</TableHead>
              <TableHead className="text-right">無料 / 有料</TableHead>
              <TableHead>ネットワーク</TableHead>
              <TableHead>最終測定</TableHead>
              <TableHead title="x402 RFQ Market の成績。参考値でありスコアには入っていません">RFQ 参考</TableHead>
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
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.n_free} / {s.n_paid}
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
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {error
                    ? `スコアを読み込めませんでした（${error}）`
                    : !data
                      ? "読み込み中…"
                      : data.scores.length
                        ? "条件に合うホストがありません。"
                        : "まだ測定データがありません。最初の無料の測定（毎日 03:17 UTC）のあとに表示されます。"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{list.length ? `${Math.min(shown, list.length).toLocaleString()} / ${list.length.toLocaleString()} 件` : ""}</span>
        {list.length > shown && (
          <button className="liquid-glass rounded-full px-6 py-2.5 text-foreground transition-transform hover:scale-[1.03]" onClick={() => setShown(shown + 500)}>
            さらに表示
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">RFQ 参考は x402 RFQ Market での成立 / 拒否 / 未納品の件数です。参考値で、スコアの計算には入れていません。</p>
      <HostDetailDialog host={host} onClose={() => setHost(null)} />
    </section>
  );
}
