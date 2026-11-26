import { useEffect, useState } from "react";
import { getJson } from "@/lib/data";
import { type L, type Lang, useLang } from "@/lib/i18n";

// Successful payments made with a person's wallet (Phantom / Rabby) through AgentPay402:
// the tx is final on chain and the seller returned the data. No payer address is shown, only tx links.

type Rec = {
  seller: string | null; network: "solana" | "base"; wallet: string; wallet_account: "eoa" | null;
  facilitator: string | null; amount_usd: number | null; tx: string; attempted_at: string | null;
};
type Tally = { facilitator: string; network: string; delivered: number };
type Data = { generated_at: string; records: Rec[]; by_facilitator: Tally[] };

const txUrl = (r: Rec) => (r.network === "solana" ? `https://solscan.io/tx/${r.tx}` : `https://basescan.org/tx/${r.tx}`);
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const chain = (n: string) => (n === "solana" ? "Solana" : "Base");

/** Base names no facilitator in its 402: the settle transaction's sender is shown instead. */
function settled(facilitator: string | null, network: string, lang: Lang): string {
  if (!facilitator) return "—";
  return network === "base" ? `${{ ja: "settle 送信元 ", en: "settle sender ", zh: "settle 发送方 " }[lang]}${facilitator}` : facilitator;
}

function walletText(r: Rec, lang: Lang) {
  return r.wallet_account === "eoa" ? `${r.wallet}${{ ja: "（委任なし）", en: " (not delegated)", zh: "（无委托）" }[lang]}` : r.wallet;
}

const H: L[] = [
  { ja: "seller", en: "Seller", zh: "卖家" },
  { ja: "network", en: "Network", zh: "网络" },
  { ja: "ウォレット", en: "Wallet", zh: "钱包" },
  { ja: "facilitator", en: "Facilitator", zh: "facilitator" },
  { ja: "金額", en: "Amount", zh: "金额" },
  { ja: "tx", en: "tx", zh: "tx" },
  { ja: "日時（UTC）", en: "Time (UTC)", zh: "时间（UTC）" },
];

export function WalletSection() {
  const { t, lang } = useLang();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJson<Data>("/data/wallet-payments.json").then(setD, (e) => setErr(String(e?.message ?? e)));
  }, []);

  return (
    <section id="wallet" className="relative overflow-hidden py-14 md:py-20" style={{ backgroundColor: "rgb(12 12 12)", fontFamily: "var(--font-body)" }}>
      <div className="relative mx-auto max-w-5xl px-6">
        <p className="text-xs uppercase tracking-widest text-white">Wallet</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">
          {t({ ja: "ウォレットで払う場合", en: "Paying with a wallet", zh: "用钱包付款时" })}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">
          {t({
            ja: "上の購入記録は、Probe 自身の鍵による支払いです。ここには、運営者が AgentPay402 から人の操作するウォレット（Phantom・Rabby）で署名して払い、tx がチェーン上で確定し、seller がデータを返した支払いを載せています。",
            en: "The purchases above were paid with the Probe's own key. Listed here are payments the operator signed in a person's wallet (Phantom, Rabby) through AgentPay402, where the tx is final on chain and the seller returned the data.",
            zh: "上面的购买记录是用 Probe 自己的密钥付款的。这里列出的是运营者通过 AgentPay402 在人操作的钱包（Phantom、Rabby）中签名付款、tx 已在链上确认且卖家返回了数据的付款。",
          })}
        </p>
        {err && <p className="mt-3 text-sm text-white/50">{t({ ja: "読み込めませんでした", en: "Could not load", zh: "无法加载" })}（{err}）</p>}

        <h3 className="mt-8 text-sm font-medium text-white">{t({ ja: "ウォレットで払えた支払い", en: "Payments made with a wallet", zh: "用钱包完成的付款" })}</h3>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-white/50">
              <tr className="border-b border-white/10">
                {H.map((h) => (
                  <th key={h.en} className="px-3 py-2 font-normal">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {(d?.records ?? []).map((r) => (
                <tr key={r.tx}>
                  <td className="px-3 py-2">{r.seller ?? "—"}</td>
                  <td className="px-3 py-2">{chain(r.network)}</td>
                  <td className="px-3 py-2">{walletText(r, lang)}</td>
                  <td className="px-3 py-2">{settled(r.facilitator, r.network, lang)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.amount_usd !== null ? `${r.amount_usd} USDC` : "—"}</td>
                  <td className="px-3 py-2">
                    <a className="underline underline-offset-2" href={txUrl(r)} target="_blank" rel="noreferrer">
                      {short(r.tx)}
                    </a>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-white/50">{r.attempted_at ? r.attempted_at.slice(0, 16).replace("T", " ") : "—"}</td>
                </tr>
              ))}
              {!d && !err && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-white/50">
                    {t({ ja: "読み込み中…", en: "Loading…", zh: "加载中…" })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className="mt-8 text-sm font-medium text-white">{t({ ja: "facilitator ごとの件数", en: "By facilitator", zh: "按 facilitator 统计" })}</h3>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 font-normal">facilitator</th>
                <th className="px-3 py-2 font-normal">{t({ ja: "network", en: "Network", zh: "网络" })}</th>
                <th className="px-3 py-2 text-right font-normal">{t({ ja: "払えた件数", en: "Paid", zh: "付款成功" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {(d?.by_facilitator ?? []).map((f) => (
                <tr key={`${f.network}|${f.facilitator}`}>
                  <td className="px-3 py-2">{settled(f.facilitator, f.network, lang)}</td>
                  <td className="px-3 py-2">{chain(f.network)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.delivered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-white/45">
          {t({
            ja: "Solana の facilitator は、その facilitator 自身の /supported で確かめたものだけ名前を出し、それ以外は feePayer の短縮表記です。Base は 402 に facilitator を示す欄がないため、settle の取引の送信元を短縮表記で出します。払う側のウォレットのアドレスは載せず、tx へのリンクだけを出します。",
            en: "On Solana a facilitator is named only when its own /supported confirms the fee payer; otherwise the fee payer is shown shortened. On Base the 402 names no facilitator, so the settle transaction's sender is shown shortened. The paying wallet's address is never shown; only links to the tx are.",
            zh: "Solana 上只有经该 facilitator 自身的 /supported 确认的才显示名称，其余显示 feePayer 的缩写。Base 的 402 中没有标明 facilitator 的字段，因此显示 settle 交易发送方的缩写。不显示付款钱包的地址，只显示 tx 的链接。",
          })}
        </p>

        <h3 className="mt-8 text-sm font-medium text-white">{t({ ja: "データの取得", en: "Get the data", zh: "获取数据" })}</h3>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/80">curl https://probe.x402jp.com/data/wallet-payments.json</pre>
      </div>
    </section>
  );
}
