import { useEffect, useState } from "react";
import { type L, LangSwitch, useLang } from "@/lib/i18n";
import { Footer } from "./Footer";
import { SectionTitle } from "./SectionTitle";

type Item = { id: string; label: string; status: "pass" | "fail" | "warn" | "info" | "na"; detail: string; fix: string | null; link?: string };
type Report = { url: string; host: string; checked_at: string; items: Item[] };

const MARK: Record<Item["status"], { t: L; c: string }> = {
  pass: { t: { ja: "OK", en: "OK", zh: "通过" }, c: "text-good" },
  fail: { t: { ja: "NG", en: "Fail", zh: "未通过" }, c: "text-bad" },
  warn: { t: { ja: "注意", en: "Warn", zh: "注意" }, c: "text-mid" },
  info: { t: { ja: "情報", en: "Info", zh: "信息" }, c: "text-muted-foreground" },
  na: { t: { ja: "—", en: "—", zh: "—" }, c: "text-muted-foreground" },
};

export function CheckPage() {
  const { t, lang } = useLang();
  const initial = new URLSearchParams(window.location.search).get("u") ?? "";
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(target: string) {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const r = await fetch(`/check?url=${encodeURIComponent(target.trim())}&lang=${lang}`);
      const d = await r.json();
      if (!r.ok) setError(d.error ?? `HTTP ${r.status}`);
      else setReport(d);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initial) void run(initial);
  }, []);
  // The results come from the server in the chosen language: check again when it changes.
  useEffect(() => {
    if (report) void run(report.url);
  }, [lang]);

  return (
    <>
      <main className="mx-auto max-w-4xl px-6 py-16 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Seller Probe</a>
          <LangSwitch />
        </div>
        <div className="mt-8">
          <SectionTitle eyebrow="Seller check" title="Check your x402 endpoint">
            <p>
              {t({
                ja: "URL を 1 つ入れると、その場で支払いなしに検査します（GET を 1 回と /.well-known/x402-receipt.json を 1 回）。再送や負荷の試験はしません。同じホストは 1 分に 1 回まで。決済ヘッダを返すかは支払わないと分からないため、Probe の有料測定の記録があればそれを出します。",
                en: "Enter one URL and it is checked on the spot, without paying (one GET and one /.well-known/x402-receipt.json). No replay or load testing. Once a minute per host. Whether a settlement header comes back can only be known by paying, so the Probe's paid record is shown when there is one.",
                zh: "输入一个 URL，即可当场在不付款的情况下检查（一次 GET 和一次 /.well-known/x402-receipt.json）。不做重放或负载测试。同一主机每分钟 1 次。是否返回结算头只有付款后才能知道，因此若有 Probe 的付费测量记录，会一并显示。",
              })}
            </p>
          </SectionTitle>
        </div>
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void run(url);
          }}
        >
          <input
            id="check-url"
            aria-label={t({ ja: "検査する URL", en: "URL to check", zh: "要检查的 URL" })}
            className="min-w-0 flex-1 rounded-full border bg-card/60 px-5 py-2.5 text-sm outline-none focus:border-foreground"
            placeholder="https://your-api.example/paid/route"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
          />
          <button type="submit" disabled={busy || !url.trim()} className="liquid-glass rounded-full px-6 py-2.5 text-sm text-foreground disabled:opacity-50">
            {busy ? t({ ja: "検査中…", en: "Checking…", zh: "检查中…" }) : t({ ja: "検査する", en: "Check", zh: "检查" })}
          </button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          {lang === "ja" && (
            <>
              継続監視：<code className="text-foreground">POST /monitor</code> に <code className="text-foreground">{"{ url, webhook }"}</code> を x402 で $0.10（30 日）払って送ると、毎日の測定で
              402 を返さなくなった・形式が崩れた・価格や payTo が変わった・Delivery Receipt の鍵が消えたときと、有料の測定の結果が出たときに、その webhook へ通知します（署名付き）。
            </>
          )}
          {lang === "en" && (
            <>
              Monitoring: send <code className="text-foreground">{"{ url, webhook }"}</code> to <code className="text-foreground">POST /monitor</code>, paying $0.10 (30 days) with x402, and the webhook is notified (signed) when the daily
              measurement sees the 402 stop, its format break, the price or payTo change, or the Delivery Receipt key disappear, and when a paid measurement result comes in.
            </>
          )}
          {lang === "zh" && (
            <>
              持续监控：用 x402 支付 $0.10（30 天），向 <code className="text-foreground">POST /monitor</code> 发送 <code className="text-foreground">{"{ url, webhook }"}</code>，
              当每日测量发现不再返回 402、格式损坏、价格或 payTo 变化、Delivery Receipt 的密钥消失，以及付费测量结果出来时，会通知该 webhook（带签名）。
            </>
          )}
        </p>
        {error && <p className="mt-6 text-sm text-bad">{error}</p>}
        {report && (
          <div className="mt-8">
            <p className="mb-3 break-all text-sm text-muted-foreground">
              {report.url} ・ {report.checked_at.replace("T", " ").slice(0, 19)} UTC
            </p>
            <ul className="divide-y rounded-xl border bg-card/60">
              {report.items.map((i) => (
                <li key={i.id} className="flex gap-4 p-4 text-sm">
                  <span className={`w-12 shrink-0 font-medium ${MARK[i.status].c}`}>{t(MARK[i.status].t)}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{i.label}</p>
                    <p className="break-words text-muted-foreground">{i.detail}</p>
                    {i.fix && i.status !== "pass" && (
                      <p className="mt-1 break-words">
                        {t({ ja: "直し方：", en: "How to fix: ", zh: "修改方法：" })}
                        {i.fix}
                      </p>
                    )}
                    {i.link && i.status !== "pass" && (
                      <a className="mt-1 inline-block underline underline-offset-4" href={i.link} target="_blank" rel="noreferrer">
                        {t({ ja: "組み込み手順", en: "Integration steps", zh: "集成步骤" })}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
