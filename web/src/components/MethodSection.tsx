import type { ReactNode } from "react";
import type { Scores } from "@/lib/data";
import { type L, useLang } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";

const endpointLink = (
  <a className="underline underline-offset-4" href="https://github.com/kato9292929/endpoint">
    x402 Endpoint
  </a>
);
const logLink = (
  <a className="underline underline-offset-4" href="https://github.com/kato9292929/seller-probe/tree/main/log">
    log/
  </a>
);

const ITEMS: { t: L; d: { ja: ReactNode; en: ReactNode; zh: ReactNode } }[] = [
  {
    t: { ja: "対象", en: "Scope", zh: "对象" },
    d: {
      ja: <>{endpointLink} の公開カタログから、Solana か Base の USDC を受け付けるエンドポイントを抽出し、ホストごとに最も安いものを 1 つ選びます。</>,
      en: <>From the public {endpointLink} catalog, endpoints that accept USDC on Solana or Base are taken, and the cheapest one per host is chosen.</>,
      zh: <>从 {endpointLink} 的公开目录中提取接受 Solana 或 Base 上 USDC 的端点，每个主机选出最便宜的一个。</>,
    },
  },
  {
    t: { ja: "無料の測定（毎日）", en: "Free measurement (daily)", zh: "免费测量（每天）" },
    d: {
      ja: "支払わずに GET（405 なら空の JSON で POST）し、402 の形式（x402 v1/v2、scheme・network・asset・payTo・金額・resource）、asset が公式 USDC か、payTo が前回から変わっていないか、402 までの時間を見ます。タイムアウトは 10 秒です。",
      en: "An unpaid GET (an empty JSON POST if it answers 405) checks the shape of the 402 (x402 v1/v2: scheme, network, asset, payTo, amount, resource), whether the asset is official USDC, whether payTo is unchanged, and the time to the 402. The timeout is 10 seconds.",
      zh: "不付款发送 GET（若返回 405 则用空 JSON 发送 POST），检查 402 的格式（x402 v1/v2：scheme、network、asset、payTo、金额、resource）、asset 是否为官方 USDC、payTo 是否与上次相同，以及返回 402 所需的时间。超时为 10 秒。",
    },
  },
  {
    t: { ja: "有料の測定（毎週月曜）", en: "Paid measurement (every Monday)", zh: "付费测量（每周一）" },
    d: {
      ja: "x402 Endpoint で実際に使われている事業者の中から選んだエンドポイント（最大 80 件・1 事業者 3 件まで、選び直しは毎月）を、売り手が公開している呼び方どおりの要求で 1 回ずつ買います。支払いなしで同じ要求に 402 が返ることを確かめてから払い、/settle の結果、チェーン上の送金（金額・送金先が 402 の提示と一致するか）、200 と中身が説明どおりか（出力の型・空や誤りでない・入力の反映・鮮度・データの種類）を見ます。",
      en: "Endpoints chosen from sellers actually used on x402 Endpoint (up to 80, at most 3 per seller, re-chosen monthly) are each bought once, with the request built the way the seller documents it. The Probe first confirms that the same request unpaid answers 402, then pays, and checks /settle, the on-chain transfer (amount and recipient as in the 402), and whether a 200 came back with content as described (output shape, not empty or an error, the input reflected, freshness, the kind of data).",
      zh: "从 x402 Endpoint 上实际被使用的卖家中选出端点（最多 80 个，每个卖家最多 3 个，每月重选），按卖家公开的调用方式构造请求，各购买一次。先确认同一请求在不付款时返回 402，再付款，并检查 /settle 结果、链上转账（金额和收款方是否与 402 一致）、是否返回 200 且内容与说明相符（输出格式、非空且非错误、输入是否反映、时效、数据种类）。",
    },
  },
  {
    t: { ja: "支払いの上限", en: "Payment caps", zh: "付款上限" },
    d: {
      ja: "1 コール $0.01、7 日間で $25。コードで強制し、超える購入は署名の前に止めます。",
      en: "$0.01 per call and $25 per 7 days, enforced in code; a purchase above them is stopped before anything is signed.",
      zh: "每次调用 $0.01，7 天内共 $25。由代码强制执行，超出的购买在签名之前就会被阻止。",
    },
  },
  {
    t: { ja: "Delivery Receipt", en: "Delivery Receipt", zh: "Delivery Receipt" },
    d: {
      ja: "売り手が /.well-known/x402-receipt.json で公開鍵を出していれば「Receipt」と表示し、有料の測定で受け取ったレシート（署名・本文のハッシュ・支払い ID）を検証します。レシートは任意で、出していない売り手を減点することはありません。",
      en: "If a seller publishes a public key at /.well-known/x402-receipt.json it is marked “Receipt”, and the receipt received on a paid measurement (signature, body hash, payment ID) is verified. Receipts are optional; sellers without one lose no points.",
      zh: "卖家若在 /.well-known/x402-receipt.json 公开了公钥，则显示“Receipt”，并验证付费测量中收到的收据（签名、正文哈希、付款 ID）。收据是可选的，不提供收据的卖家不会被扣分。",
    },
  },
  {
    t: { ja: "記録", en: "Records", zh: "记录" },
    d: {
      ja: <>すべての測定は {logLink} に追記しています（上書き・削除なし）。有料の測定には自分の署名と tx を含めています。</>,
      en: <>Every measurement is appended to {logLink} (never overwritten or deleted). Paid measurements include our own signature and the tx.</>,
      zh: <>所有测量都追加记录在 {logLink} 中（不覆盖、不删除）。付费测量包含我们自己的签名和 tx。</>,
    },
  },
];

const DROP_LABEL: Record<string, L> = {
  "requires_input (observed)": {
    ja: "入力が必要（前回の購入で売り手のエラー応答から判明・4 週ごとに測り直し）",
    en: "Needs input (seen in the seller's error on an earlier purchase; re-measured every 4 weeks)",
    zh: "需要输入（由上次购买时卖家的错误响应得知；每 4 周重新测量）",
  },
  "requires_auth (observed)": {
    ja: "認証が必要（前回の購入で HTTP 401・4 週ごとに測り直し）",
    en: "Needs authentication (HTTP 401 on an earlier purchase; re-measured every 4 weeks)",
    zh: "需要认证（上次购买时返回 HTTP 401；每 4 周重新测量）",
  },
  requires_input: { ja: "入力が必要（402 の入力スキーマ）", en: "Needs input (the 402's input schema)", zh: "需要输入（402 的输入模式）" },
  no_402: { ja: "入力なしの GET で 402 を返さない", en: "No 402 on a GET without input", zh: "无输入的 GET 不返回 402" },
  not_payable: { ja: "払える提示がない（金額 0・公式 USDC 以外など）", en: "Nothing payable offered (amount 0, not official USDC, …)", zh: "没有可付款的报价（金额为 0、非官方 USDC 等）" },
  excluded: { ja: "除外（賭博など）", en: "Excluded (gambling, …)", zh: "排除（赌博等）" },
};

export function MethodSection({ data }: { data: Scores | null }) {
  const { t, lang } = useLang();
  const pt = data?.paid_targets;
  const dropped = pt?.dropped ?? pt?.requires_input ?? null;
  const kind = (r: string) => r.split(":")[0];
  const sep = lang === "en" ? ", " : "、";
  return (
    <section id="method" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-24 sm:px-8">
      <SectionTitle eyebrow="Method" title="What we measure, and how" />
      <div className="grid gap-4 md:grid-cols-2">
        {ITEMS.map((i) => (
          <div key={i.t.ja} className="rounded-xl border bg-card/60 p-6">
            <h3 className="mb-2 text-lg font-medium">{t(i.t)}</h3>
            <p className="leading-relaxed text-muted-foreground">{i.d[lang]}</p>
          </div>
        ))}
        <div className="rounded-xl border bg-card/60 p-6 md:col-span-2">
          <h3 className="mb-2 text-lg font-medium">
            {t({
              ja: "入力なしの GET で買える売り手の判定（スコア用）",
              en: "Which sellers can be bought with a bare GET (for the scores)",
              zh: "哪些卖家可用无输入的 GET 购买（用于评分）",
            })}
          </h3>
          <p className="leading-relaxed text-muted-foreground">
            {t({
              ja: "毎日の選定では、次の売り手を「入力なしの GET では買えない」と判定し、理由とともに記録します。①入力なしの GET で 402 を返さない売り手と、402 に払える提示がない売り手（金額 0、公式 USDC 以外、上限 $0.01 超など）。②402 の入力スキーマ（bazaar 拡張や outputSchema）に必須の本文・クエリ・POST などがある売り手と、前回の購入で売り手自身のエラー応答から入力が必要と分かった売り手、HTTP 401 で支払いのほかに認証を求めた売り手（後者は 4 週たつと測り直します）。③くじなど賭博にあたる売り手（除外リストは config/exclusions.json に理由付きで公開）。",
              en: "The daily selection marks the following sellers as “not buyable with a bare GET” and records why. (1) Sellers that return no 402 to a GET without input, and sellers whose 402 offers nothing payable (amount 0, not official USDC, above the $0.01 cap, …). (2) Sellers whose 402 input schema (bazaar extension or outputSchema) requires a body, query or POST; sellers whose own error on an earlier purchase showed that input is needed; and sellers that asked for authentication besides payment with HTTP 401 (these are re-measured after 4 weeks). (3) Lotteries and other gambling (the exclusion list, with reasons, is published in config/exclusions.json).",
              zh: "每天的筛选会把以下卖家判定为“无法用无输入的 GET 购买”，并记录原因。① 对无输入的 GET 不返回 402 的卖家，以及 402 中没有可付款报价的卖家（金额为 0、非官方 USDC、超过 $0.01 上限等）。② 402 的输入模式（bazaar 扩展或 outputSchema）要求必填的正文、查询或 POST 的卖家；在上次购买中由卖家自己的错误响应得知需要输入的卖家；以及除付款外还以 HTTP 401 要求认证的卖家（后者 4 周后重新测量）。③ 彩票等赌博类卖家（排除列表连同原因公开在 config/exclusions.json）。",
            })}
          </p>
          {dropped === null ? (
            <p className="mt-3 text-sm">{t({ ja: "外したホスト：—", en: "Hosts left out: —", zh: "排除的主机：—" })}</p>
          ) : (
            <div className="mt-3 text-sm">
              <p>
                {t({
                  ja: `${pt!.date} の選定で外したホスト：${dropped.length} 件`,
                  en: `Hosts left out in the ${pt!.date} selection: ${dropped.length}`,
                  zh: `${pt!.date} 的筛选中排除的主机：${dropped.length} 个`,
                })}
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {Object.entries(DROP_LABEL).map(([k, label]) => {
                  const hs = dropped.filter((d) => kind(d.reason) === k);
                  return hs.length ? (
                    <li key={k} className="break-words">
                      {t(label)}
                      {lang === "en" ? ": " : "："}
                      {hs.length}
                      {t({ ja: " 件", en: "", zh: " 个" })}（{hs.map((d) => d.host).join(sep)}）
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {t({
              ja: "支払いを送っても送金されないまま 4xx・402 が返った回（購入不成立）は、納品の成否に数えず件数だけを表示します。2026-10-19 の記録はこの区分ができる前のものなので、送金なしで 4xx・402 だった行を集計時に購入不成立として読み替えています（ログ自体は書き換えていません）。",
              en: "Purchases where a payment was sent but no transfer happened and a 4xx or 402 came back (purchase not completed) are not counted as delivered or not delivered; only their number is shown. Records from 2026-10-19 predate this category, so rows with no transfer and a 4xx or 402 are read as “not completed” when counted (the log itself is not rewritten).",
              zh: "已发送付款但未发生转账、并返回 4xx 或 402 的情况（购买未成立）不计入交付成败，只显示次数。2026-10-19 的记录早于这一分类，因此在统计时把无转账且返回 4xx 或 402 的行视为购买未成立（日志本身未改写）。",
            })}
          </p>
        </div>
      </div>
    </section>
  );
}
