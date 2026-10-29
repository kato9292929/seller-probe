import { useEffect, useState } from "react";
import { Footer } from "./Footer";
import { SectionTitle } from "./SectionTitle";

type Item = { id: string; label: string; status: "pass" | "fail" | "warn" | "info" | "na"; detail: string; fix: string | null };
type Report = { url: string; host: string; checked_at: string; items: Item[] };

const MARK: Record<Item["status"], { t: string; c: string }> = {
  pass: { t: "OK", c: "text-good" },
  fail: { t: "NG", c: "text-bad" },
  warn: { t: "注意", c: "text-mid" },
  info: { t: "情報", c: "text-muted-foreground" },
  na: { t: "—", c: "text-muted-foreground" },
};

export function CheckPage() {
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
      const r = await fetch(`/check?url=${encodeURIComponent(target.trim())}`);
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

  return (
    <>
      <main className="mx-auto max-w-4xl px-6 py-16 sm:px-8">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Seller Probe</a>
        <div className="mt-8">
          <SectionTitle eyebrow="Seller check" title="Check your x402 endpoint">
            <p>
              URL を 1 つ入れると、その場で支払いなしに検査します（GET を 1 回と /.well-known/x402-receipt.json を 1 回）。
              再送や負荷の試験はしません。同じホストは 1 分に 1 回まで。決済ヘッダを返すかは支払わないと分からないため、Probe の有料測定の記録があればそれを出します。
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
            className="min-w-0 flex-1 rounded-full border bg-card/60 px-5 py-2.5 text-sm outline-none focus:border-foreground"
            placeholder="https://your-api.example/paid/route"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
          />
          <button type="submit" disabled={busy || !url.trim()} className="liquid-glass rounded-full px-6 py-2.5 text-sm text-foreground disabled:opacity-50">
            {busy ? "検査中…" : "検査する"}
          </button>
        </form>
        {error && <p className="mt-6 text-sm text-bad">{error}</p>}
        {report && (
          <div className="mt-8">
            <p className="mb-3 break-all text-sm text-muted-foreground">
              {report.url} ・ {report.checked_at.replace("T", " ").slice(0, 19)} UTC
            </p>
            <ul className="divide-y rounded-xl border bg-card/60">
              {report.items.map((i) => (
                <li key={i.id} className="flex gap-4 p-4 text-sm">
                  <span className={`w-10 shrink-0 font-medium ${MARK[i.status].c}`}>{MARK[i.status].t}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{i.label}</p>
                    <p className="break-words text-muted-foreground">{i.detail}</p>
                    {i.fix && i.status !== "pass" && <p className="mt-1 break-words">直し方：{i.fix}</p>}
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
