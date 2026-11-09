import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getJson } from "@/lib/data";
import { type Curated, EndpointDetail, type Item, TONE } from "./CuratedSection";

// The cards follow x402jp.com's "x402 Endpoint" section: logo, name and 1P/3P badge, host ·
// category, price and endpoint count, two columns in one glass panel. Numbers and dates come from
// /data/curated.json (written by the build), never from this file.

type Card = {
  operator: string; slug: string; name: string; party: "1P" | "3P"; via: string | null; host: string; domain: string | null; category: string | null;
  logo: string | null; logo_source: string; initials: string;
  badge: "as_described" | "not_as_described" | "not_delivered" | "not_bought"; badge_label: string;
  endpoints: number; bought: number; as_described: number; price_min: number | null; tx: number | null; buyers: number | null;
  delivered_without_payment: number; not_bought_reason: string | null;
  item_ids: string[];
};
type Data = Curated & { summary: { operators: number; endpoints: number; purchased_on: string | null }; cards: Card[] };

// Green / yellow / red / grey, always with the word in the badge (not colour alone).
const BADGE_STYLE: Record<Card["badge"], string> = {
  as_described: "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
  not_as_described: "border-amber-400/40 bg-amber-400/15 text-amber-300",
  not_delivered: "border-rose-400/40 bg-rose-400/15 text-rose-300",
  not_bought: "border-white/20 bg-white/10 text-white/60",
};

const jpDate = (d: string | null) => (d ? `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : "—");
const price = (p: number | null) => (p === null ? "—" : p === 0 ? "Free" : `From $${p}`);

function Logo({ c }: { c: Card }) {
  if (c.logo) return <img src={c.logo} alt="" width={36} height={36} loading="lazy" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-1" />;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e9e7fb] text-[11px] font-bold text-[#3b2f9e]">{c.initials}</span>;
}

function CardRow({ c, onOpen, dup }: { c: Card; onOpen: () => void; dup: boolean }) {
  // Two operators under one brand (e.g. BlockRun on Base and on Solana) are told apart by their host.
  const sub = c.party === "3P" && c.via ? `via ${c.via}` : dup ? c.host : (c.domain ?? c.host);
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]">
        <Logo c={c} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <span className="truncate">{c.name}</span>
            {c.party === "1P" ? (
              <span className="rounded border border-white/25 px-1 font-mono text-[10px] text-white/60">1P</span>
            ) : (
              <span className="rounded border border-white/20 bg-white/10 px-1 font-mono text-[10px] text-white/80">3P</span>
            )}
          </p>
          <p className="truncate text-xs text-white/45">
            {sub}
            {c.category ? ` · ${c.category}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLE[c.badge]}`}>{c.badge_label}</span>
          <p className="mt-1 text-[11px] text-white/45">
            {c.bought
              ? `${c.bought}件中${c.as_described}件${c.delivered_without_payment ? `＋送金なし${c.delivered_without_payment}件` : ""}`
              : (c.not_bought_reason ?? "未購入")}
            {c.bought ? ` · ${price(c.price_min)}` : ""}
          </p>
        </div>
      </button>
    </li>
  );
}

/** The cards in two columns (one on a phone), split like the official section: left half, right half. */
function CardGrid({ cards, onOpen }: { cards: Card[]; onOpen: (c: Card) => void }) {
  const half = Math.ceil(cards.length / 2);
  const names = cards.reduce<Record<string, number>>((a, c) => ((a[c.name] = (a[c.name] ?? 0) + 1), a), {});
  return (
    <div className="liquid-glass mt-6 grid overflow-hidden rounded-2xl md:grid-cols-2 md:divide-x md:divide-white/10">
      {[cards.slice(0, half), cards.slice(half)].map((col, k) => (
        <ul key={k} className={`divide-y divide-white/10 ${k === 1 ? "border-t border-white/10 md:border-t-0" : ""}`}>
          {col.map((c) => <CardRow key={c.operator} c={c} dup={names[c.name] > 1} onOpen={() => onOpen(c)} />)}
        </ul>
      ))}
    </div>
  );
}

function OperatorDialog({ card, items, onClose }: { card: Card | null; items: Item[]; onClose: () => void }) {
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        {card && (
          <>
            <DialogTitle className="flex items-center gap-3">
              <Logo c={card} />
              <span>{card.name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLE[card.badge]}`}>{card.badge_label}</span>
            </DialogTitle>
            <DialogDescription>
              {card.host} · x402 Endpoint の tx {card.tx?.toLocaleString() ?? "—"}・buyer {card.buyers?.toLocaleString() ?? "—"} · 買ったエンドポイント {card.bought} 件中、説明どおり {card.as_described} 件
            </DialogDescription>
            <div className="mt-2 space-y-3">
              {items.map((i) => (
                <div key={i.id} className="rounded-lg border bg-card/60 px-4 py-3">
                  <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${TONE[i.last?.category ?? ""] === "accent" ? BADGE_STYLE.as_described : "border-white/20 text-white/70"}`}>{i.last?.category_label ?? "未購入"}</span>
                    <span className="break-all text-white/80">{i.last?.request?.method ?? ""} {new URL(i.url).pathname}</span>
                    {i.price_usd !== null && <span className="text-white/45">${i.price_usd}</span>}
                  </p>
                  <EndpointDetail i={i} />
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function useCurated() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJson<Data>("/data/curated.json").then(setD, (e) => setErr(String(e?.message ?? e)));
  }, []);
  return { d, err };
}

/** Top of the home page (`limit` cards) and the full list on /purchases (no limit). */
export function OperatorCards({ limit, full = false }: { limit?: number; full?: boolean }) {
  const { d, err } = useCurated();
  const [open, setOpen] = useState<Card | null>(null);
  const cards = d?.cards ?? [];
  const shown = limit ? cards.slice(0, limit) : cards;
  const items = open && d ? d.items.filter((i) => open.item_ids.includes(i.id)) : [];
  return (
    <section
      id="purchases"
      className="relative overflow-hidden py-16 md:py-24"
      style={{
        backgroundColor: "rgb(12 12 12)",
        backgroundImage:
          "radial-gradient(60% 50% at 15% 0%, rgba(126,139,240,0.16), transparent 70%), radial-gradient(50% 45% at 90% 20%, rgba(245,124,230,0.10), transparent 70%), radial-gradient(60% 50% at 50% 100%, rgba(94,227,236,0.08), transparent 70%)",
        fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif",
      }}
    >
      <div className="relative mx-auto max-w-5xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-white">Seller Probe</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">使われている API を、使い方どおりに買った結果</h2>
            <p className="mt-2 text-sm text-white/55">
              {d
                ? `x402 Endpoint で使われている ${d.summary.operators} 事業者（${d.summary.endpoints} エンドポイント）を、実際に払って確かめた結果（${jpDate(d.summary.purchased_on)}購入）。`
                : err
                  ? `結果を読み込めませんでした（${err}）`
                  : "読み込み中…"}
            </p>
          </div>
          {!full && (
            <a href="/purchases" className="inline-flex items-center gap-1.5 text-sm text-white/80 transition-colors hover:text-white">
              結果を全部見る
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M7 7h10v10" />
                <path d="M7 17 17 7" />
              </svg>
            </a>
          )}
        </div>
        {shown.length > 0 && <CardGrid cards={shown} onOpen={setOpen} />}
        <p className="mt-3 text-[11px] text-white/40">1P は自社ドメインでの提供、3P は決済ゲートウェイ経由の提供です。</p>
        <p className="mt-1 text-[11px] text-white/40">
          バッジは事業者ごとに、買ったエンドポイントのうち一番悪い結果です（説明どおり・説明と違う・届かなかった）。「N件中M件」は買った件数と、そのうち説明どおりに届いた件数。「送金なし」は送金が起きないまま届いたもので、失敗には数えていません。払わなかったもの（$0.01 超・使い方の公開なし・入力が合わない）だけの事業者は未購入とし、理由をカードに出して後ろに並べます。カードを押すとエンドポイントごとの要求・応答・確認・tx を開きます。
        </p>
      </div>
      <OperatorDialog card={open} items={items} onClose={() => setOpen(null)} />
    </section>
  );
}
