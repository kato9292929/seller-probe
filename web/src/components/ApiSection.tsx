import { useLang } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";

export function ApiSection() {
  const { t, lang } = useLang();
  const mcp = (
    <a className="text-foreground underline underline-offset-4" href="https://github.com/kato9292929/x402-wallet-mcp">
      AgentPay402 MCP
    </a>
  );
  return (
    <section id="api" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="API" title="Use the scores in your agent">
        {lang === "ja" && (
          <p>
            静的な JSON です（CORS 許可、5 分キャッシュ）。x402 RFQ Market の買い手は、仕様の <code className="text-foreground">min_probe_score</code>{" "}
            でこのスコアを見積もりの選定条件に使えます。エージェントから払うなら {mcp}（npm <code className="text-foreground">agentpay402-mcp</code>）が、払う前にこの API を引いて「払ったのに届かない」ホストには払いません。
          </p>
        )}
        {lang === "en" && (
          <p>
            Static JSON (CORS allowed, cached for 5 minutes). Buyers on the x402 RFQ Market can use these scores to pick quotes through the spec's{" "}
            <code className="text-foreground">min_probe_score</code>. When an agent pays, {mcp} (npm <code className="text-foreground">agentpay402-mcp</code>) reads this API first and does not pay hosts that took payment without delivering.
          </p>
        )}
        {lang === "zh" && (
          <p>
            静态 JSON（允许 CORS，缓存 5 分钟）。x402 RFQ Market 的买家可以通过规范中的 <code className="text-foreground">min_probe_score</code>{" "}
            把这些评分作为选择报价的条件。由代理付款时，{mcp}（npm <code className="text-foreground">agentpay402-mcp</code>）会先查询此 API，不向“付了款却未交付”的主机付款。
          </p>
        )}
      </SectionTitle>
      <pre className="overflow-x-auto rounded-xl border bg-card/60 p-5 text-sm leading-relaxed">
        {t({
          ja: `GET /scores          全ホストのスコア一覧
GET /scores/:host    ホスト別の詳細と直近の測定履歴（未測定のホストは 404）
                     buyable_without_input・requires_input_reason・last_paid（買う前の照会用）
GET /check?url=…     売り手の点検（支払いなしでその場で検査。同じホストは 1 分に 1 回）`,
          en: `GET /scores          scores of every host
GET /scores/:host    one host's detail and recent measurements (404 if not measured)
                     buyable_without_input, requires_input_reason, last_paid (to look up before buying)
GET /check?url=…     seller check (on the spot, without paying; once a minute per host)`,
          zh: `GET /scores          所有主机的评分列表
GET /scores/:host    单个主机的详情与最近的测量记录（未测量的主机返回 404）
                     buyable_without_input、requires_input_reason、last_paid（购买前查询用）
GET /check?url=…     卖家自检（当场检查，不付款；同一主机每分钟 1 次）`,
        })}
        {`

curl https://probe.x402jp.com/scores/sol.blockrun.ai`}
      </pre>
    </section>
  );
}
