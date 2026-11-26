import { useEffect, useState } from "react";
import { getJson } from "@/lib/data";
import { type L, type Lang, useLang } from "@/lib/i18n";

// Paying with a person's wallet (Phantom / Rabby / MetaMask). Records come from payments the owner
// signed through AgentPay402 (/data/wallet-payments.json); outlooks are shown on the cards above and
// are kept apart from records in wording. No payer address is ever shown, only links to the tx.

type Rec = {
  seller: string | null; host: string | null; network: "solana" | "base"; wallet: string; wallet_account?: "eoa" | "eip7702";
  facilitator: string | null; amount_usd: number | null; outcome: string; reason: string | null; tx: string | null; attempted_at: string | null;
  verified_onchain: { status: string; checked_at: string; detail: string | null };
};
type Tally = { facilitator: string; phantom_attempts: number; delivered: number; rejected: number };
type Data = { generated_at: string; records: Rec[]; by_facilitator: Tally[] };

export const OUTCOME: Record<string, L> = {
  delivered: { ja: "払えた・届いた", en: "Paid and delivered", zh: "已付款并送达" },
  facilitator_rejected: { ja: "facilitator が拒否", en: "Refused by the facilitator", zh: "facilitator 拒绝" },
  wallet_simulation_stopped: { ja: "ウォレットのシミュレーションで止まった", en: "Stopped at the wallet's simulation", zh: "在钱包模拟时中止" },
  seller_error: { ja: "seller 側の障害", en: "Seller-side failure", zh: "卖家端故障" },
  agentpay_mismatch: { ja: "AgentPay402 の照合で止まった", en: "Stopped by AgentPay402's re-check", zh: "在 AgentPay402 核对时中止" },
  signature_check_failed: { ja: "署名の確認で落ちた", en: "Signature failed the on-chain check", zh: "签名未通过链上验证" },
};
const TONE: Record<string, string> = {
  delivered: "text-emerald-300",
  facilitator_rejected: "text-rose-300",
  seller_error: "text-amber-300",
};

/** Phantom outlook (before paying; not a record). */
export const OUTLOOK: Record<string, L> = {
  accepted_facilitator: { ja: "受け付けた記録のある facilitator", en: "a facilitator with an accepted Phantom payment on record", zh: "有接受 Phantom 付款记录的 facilitator" },
  rejected_facilitator: { ja: "拒否の記録のある facilitator", en: "a facilitator with a refusal on record", zh: "有拒绝记录的 facilitator" },
  no_ata: { ja: "受取口座がない（送金は失敗する）", en: "the seller's receiving account does not exist (the transfer fails)", zh: "收款账户不存在（转账会失败）" },
  unverified: { ja: "未検証", en: "not verified", zh: "未验证" },
  no_solana: { ja: "Solana の支払い先なし", en: "no Solana payment option", zh: "无 Solana 付款选项" },
};

const txUrl = (r: Rec) => (r.network === "solana" ? `https://solscan.io/tx/${r.tx}` : `https://basescan.org/tx/${r.tx}`);
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

function walletText(r: Rec, lang: Lang) {
  if (r.wallet_account === "eip7702") return `${r.wallet}${{ ja: "（EIP-7702 委任あり）", en: " (EIP-7702 delegated)", zh: "（已有 EIP-7702 委托）" }[lang]}`;
  return r.wallet;
}

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
            ja: "上の購入記録は、Probe 自身の鍵による支払いです。人が操作するウォレット（Phantom・Rabby・MetaMask）で払えるかは、seller が使う facilitator によって変わります。下の表は、運営者が AgentPay402 からウォレットで署名して払った記録です。カードの「Phantom の見込み」は払う前に分かる条件からの見込みで、記録とは別です。",
            en: "The purchases above were paid with the Probe's own key. Whether a person's wallet (Phantom, Rabby, MetaMask) can pay depends on the facilitator the seller uses. The tables below are payments the operator signed in a wallet through AgentPay402. The “Phantom outlook” on each card is an outlook from what can be known before paying, not a record.",
            zh: "上面的购买记录是用 Probe 自己的密钥付款的。人操作的钱包（Phantom、Rabby、MetaMask）能否付款，取决于卖家使用的 facilitator。下表是运营者通过 AgentPay402 在钱包中签名付款的记录。卡片上的“Phantom 预估”是根据付款前可知的条件得出的预估，与记录分开。",
          })}
        </p>
        {err && <p className="mt-3 text-sm text-white/50">{t({ ja: "読み込めませんでした", en: "Could not load", zh: "无法加载" })}（{err}）</p>}

        <h3 className="mt-8 text-sm font-medium text-white">{t({ ja: "ウォレットで払った記録", en: "Payments made with a wallet", zh: "用钱包付款的记录" })}</h3>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-white/50">
              <tr className="border-b border-white/10">
                {[
                  { ja: "seller", en: "Seller", zh: "卖家" },
                  { ja: "network", en: "Network", zh: "网络" },
                  { ja: "ウォレット", en: "Wallet", zh: "钱包" },
                  { ja: "facilitator", en: "Facilitator", zh: "facilitator" },
                  { ja: "結果", en: "Result", zh: "结果" },
                  { ja: "理由", en: "Reason", zh: "原因" },
                  { ja: "tx", en: "tx", zh: "tx" },
                  { ja: "日時（UTC）", en: "Time (UTC)", zh: "时间（UTC）" },
                ].map((h) => (
                  <th key={h.en} className="px-3 py-2 font-normal">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {(d?.records ?? []).map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">{r.seller ?? "—"}</td>
                  <td className="px-3 py-2">{r.network === "solana" ? "Solana" : "Base"}</td>
                  <td className="px-3 py-2">{walletText(r, lang)}</td>
                  <td className="px-3 py-2">{r.facilitator ?? "—"}</td>
                  <td className={`px-3 py-2 ${TONE[r.outcome] ?? "text-white/70"}`}>{OUTCOME[r.outcome] ? t(OUTCOME[r.outcome]) : r.outcome}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-white/60">{r.reason ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.tx ? (
                      <a className="underline underline-offset-2" href={txUrl(r)} target="_blank" rel="noreferrer">
                        {short(r.tx)}
                      </a>
                    ) : r.verified_onchain.status === "no_transfer" ? (
                      <span className="text-white/50">{t({ ja: "送金なし（確認済み）", en: "no transfer (checked)", zh: "无转账（已确认）" })}</span>
                    ) : (
                      "—"
                    )}
                    {r.tx && r.verified_onchain.status === "finalized" && (
                      <span className="ml-1 text-white/40">{t({ ja: "確定", en: "finalized", zh: "已确认" })}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-white/50">{r.attempted_at ? r.attempted_at.slice(0, 16).replace("T", " ") : "—"}</td>
                </tr>
              ))}
              {!d && !err && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-white/50">
                    {t({ ja: "読み込み中…", en: "Loading…", zh: "加载中…" })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className="mt-8 text-sm font-medium text-white">{t({ ja: "facilitator ごとのまとめ（Phantom）", en: "By facilitator (Phantom)", zh: "按 facilitator 汇总（Phantom）" })}</h3>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 font-normal">facilitator</th>
                <th className="px-3 py-2 text-right font-normal">{t({ ja: "Phantom の取引", en: "Phantom payments", zh: "Phantom 交易" })}</th>
                <th className="px-3 py-2 text-right font-normal">{t({ ja: "払えた件数", en: "Paid", zh: "付款成功" })}</th>
                <th className="px-3 py-2 text-right font-normal">{t({ ja: "拒否の件数", en: "Refused", zh: "被拒绝" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {(d?.by_facilitator ?? []).map((f) => (
                <tr key={f.facilitator}>
                  <td className="px-3 py-2">{f.facilitator}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.phantom_attempts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.delivered}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-white/45">
          {t({
            ja: "Base は、委任のない EOA から払った記録がまだないため、見込みは「未検証」です。EIP-7702 の委任があるアカウント（Rabby）では署名の確認で落ちた記録があります。払う側のウォレットのアドレスは載せず、tx へのリンクだけを出します。",
            en: "On Base there is no record yet of a payment from a non-delegated EOA, so its outlook is “not verified”. An account with an EIP-7702 delegation (Rabby) has a record of the signature failing the on-chain check. The paying wallet's address is never shown; only links to the tx are.",
            zh: "Base 上还没有从无委托的 EOA 付款的记录，因此预估为“未验证”。有 EIP-7702 委托的账户（Rabby）有签名未通过链上验证的记录。不显示付款钱包的地址，只显示 tx 的链接。",
          })}
        </p>

        <h3 className="mt-8 text-sm font-medium text-white">{t({ ja: "データの取得", en: "Get the data", zh: "获取数据" })}</h3>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/80">
          {`curl https://probe.x402jp.com/data/wallet-payments.json
curl https://probe.x402jp.com/data/curated.json   # ${t({ ja: "各エンドポイントに wallet_precheck を追加", en: "wallet_precheck on each endpoint", zh: "每个端点附有 wallet_precheck" })}`}
        </pre>
      </div>
    </section>
  );
}
