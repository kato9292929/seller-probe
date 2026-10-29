import { SectionTitle } from "./SectionTitle";

export function ApiSection() {
  return (
    <section id="api" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="API" title="Use the scores in your agent">
        <p>
          静的な JSON です（CORS 許可、5 分キャッシュ）。x402 RFQ Market の買い手は、仕様の <code className="text-foreground">min_probe_score</code>{" "}
          でこのスコアを見積もりの選定条件に使えます。
        </p>
      </SectionTitle>
      <pre className="overflow-x-auto rounded-xl border bg-card/60 p-5 text-sm leading-relaxed">
        {`GET /scores          全ホストのスコア一覧
GET /scores/:host    ホスト別の詳細と直近の測定履歴（未測定のホストは 404）
                     buyable_without_input・requires_input_reason・last_paid（買う前の照会用）
GET /check?url=…     売り手の点検（支払いなしでその場で検査。同じホストは 1 分に 1 回）

curl https://probe.x402jp.com/scores/sol.blockrun.ai`}
      </pre>
    </section>
  );
}
