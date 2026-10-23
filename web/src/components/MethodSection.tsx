import type { Scores } from "@/lib/data";
import { SectionTitle } from "./SectionTitle";

const ITEMS = [
  {
    t: "対象",
    d: (
      <>
        <a className="underline underline-offset-4" href="https://github.com/kato9292929/endpoint">
          x402 Endpoint
        </a>{" "}
        の公開カタログから、Solana か Base の USDC を受け付けるエンドポイントを抽出し、ホストごとに最も安いものを 1 つ選びます。
      </>
    ),
  },
  {
    t: "無料の測定（毎日）",
    d: "支払わずに GET（405 なら空の JSON で POST）し、402 の形式（x402 v1/v2、scheme・network・asset・payTo・金額・resource）、asset が公式 USDC か、payTo が前回から変わっていないか、402 までの時間を見ます。タイムアウトは 10 秒です。",
  },
  {
    t: "有料の測定（週 1 回）",
    d: "直近 7 日のコール数上位のホストと無作為に選んだホストから、価格 $0.01 以下のものを 1 コール購入します。/settle の結果、チェーン上の送金（金額・送金先が 402 の提示と一致するか）、200 と空でない本文が返るか、応答時間を見ます。送金が成立したのに 200 が返らなかった場合を not_delivered とします（x402 RFQ Market の理由コード 5 と同じ判定）。",
  },
  { t: "支払いの上限", d: "1 コール $0.01、7 日間で $5。コードで強制し、超える購入は署名の前に止めます。" },
  {
    t: "記録",
    d: (
      <>
        すべての測定は{" "}
        <a className="underline underline-offset-4" href="https://github.com/kato9292929/seller-probe/tree/main/log">
          log/
        </a>{" "}
        に追記しています（上書き・削除なし）。有料の測定には自分の署名と tx を含めています。
      </>
    ),
  },
];

export function MethodSection({ data }: { data: Scores | null }) {
  const pt = data?.paid_targets;
  const dropped = pt?.dropped ?? pt?.requires_input ?? null;
  const kind = (r: string) => r.split(":")[0];
  const LABEL: Record<string, string> = { requires_input: "入力が必要", no_402: "入力なしの GET で 402 を返さない", excluded: "除外（賭博など）" };
  return (
    <section id="method" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="Method" title="What we measure, and how" />
      <div className="grid gap-4 md:grid-cols-2">
        {ITEMS.map((i) => (
          <div key={i.t} className="rounded-xl border bg-card/60 p-6">
            <h3 className="mb-2 text-lg font-medium">{i.t}</h3>
            <p className="leading-relaxed text-muted-foreground">{i.d}</p>
          </div>
        ))}
        <div className="rounded-xl border bg-card/60 p-6 md:col-span-2">
          <h3 className="mb-2 text-lg font-medium">実際に買える売り手だけを有料の対象にする</h3>
          <p className="leading-relaxed text-muted-foreground">
            有料の測定は入力なしの GET で 1 コール買います。次の売り手は対象から外し、次点を繰り上げて枠を埋めます。①入力なしの GET で 402 を返さない売り手。②402
            の入力スキーマ（bazaar 拡張や outputSchema）に必須の本文・クエリ・POST などがある売り手（こちらの入力不足で失敗するだけのため。スキーマを出していない売り手は対象に残ります）。③くじなど賭博にあたる売り手（実際のお金で賭けることになり、「届いたか」も判定できないため。除外リストは
            config/exclusions.json に理由付きで公開）。
          </p>
          {dropped === null ? (
            <p className="mt-3 text-sm">外したホスト：—</p>
          ) : (
            <div className="mt-3 text-sm">
              <p>
                {pt!.date} の選定で外したホスト：{dropped.length} 件
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {Object.entries(LABEL).map(([k, label]) => {
                  const hs = dropped.filter((d) => kind(d.reason) === k);
                  return hs.length ? (
                    <li key={k} className="break-words">
                      {label}：{hs.length} 件（{hs.map((d) => d.host).join("、")}）
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            支払いを送っても送金されないまま 4xx・402 が返った回（購入不成立）は、納品の成否に数えず件数だけを表示します。2026-10-19 の記録はこの区分ができる前のものなので、送金なしで 4xx・402 だった行を集計時に購入不成立として読み替えています（ログ自体は書き換えていません）。
          </p>
        </div>
      </div>
    </section>
  );
}
