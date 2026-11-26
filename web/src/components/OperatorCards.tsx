import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getJson } from "@/lib/data";
import { type L, type Lang, fmtDate, useLang } from "@/lib/i18n";
import { type Category, type Curated, EndpointDetail, type Item, TONE, categoryLabel } from "./CuratedSection";


// The cards follow x402jp.com's "x402 Endpoint" section: logo, name and 1P/3P badge, host ·
// category, price and endpoint count, two columns in one glass panel. Numbers and dates come from
// /data/curated.json (written by the build), never from this file.

type Card = {
  operator: string; slug: string; name: string; party: "1P" | "3P"; via: string | null; host: string; domain: string | null; category: string | null;
  logo: string | null; logo_source: string; initials: string;
  badge: "as_described" | "not_as_described" | "not_delivered" | "not_bought"; badge_label: string;
  endpoints: number; bought: number; as_described: number; price_min: number | null; tx: number | null; buyers: number | null;
  delivered_without_payment: number; not_bought_reason: string | null; not_bought_codes?: { code: string; price?: number }[];
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
const BADGE_LABEL: Record<Card["badge"], L> = {
  as_described: { ja: "説明どおり", en: "As described", zh: "与说明一致" },
  not_as_described: { ja: "説明と違う", en: "Not as described", zh: "与说明不符" },
  not_delivered: { ja: "届かなかった", en: "Not delivered", zh: "未送达" },
  not_bought: { ja: "未購入", en: "Not bought", zh: "未购买" },
};
const NOT_BOUGHT: Record<string, L> = {
  no_usage: { ja: "使い方の公開なし", en: "No published usage", zh: "未公开调用方式" },
  input_mismatch: { ja: "入力が合わない", en: "Input did not fit", zh: "输入不符" },
  input_rejected_unpaid: { ja: "Probeの入力不足", en: "Probe's input short", zh: "Probe 输入不足" },
  not_bought: { ja: "残高・上限で見送り", en: "Skipped (balance or cap)", zh: "因余额或上限跳过" },
  not_yet: { ja: "まだ購入していない", en: "Not bought yet", zh: "尚未购买" },
};

function notBoughtText(c: Card, lang: Lang): string {
  if (!c.not_bought_codes?.length) return c.not_bought_reason ?? BADGE_LABEL.not_bought[lang];
  return c.not_bought_codes
    .map((x) =>
      x.code === "over_price"
        ? ({ ja: "$0.01 超", en: "Above $0.01", zh: "超过 $0.01" } as L)[lang] + (x.price !== undefined ? `（$${x.price}）` : "")
        : (NOT_BOUGHT[x.code]?.[lang] ?? x.code),
    )
    .join(lang === "en" ? " · " : "・");
}

function countText(c: Card, lang: Lang): string {
  const extra = c.delivered_without_payment
    ? { ja: `＋送金なし${c.delivered_without_payment}件`, en: ` + ${c.delivered_without_payment} without payment`, zh: `＋未付款 ${c.delivered_without_payment} 个` }[lang]
    : "";
  return { ja: `${c.bought}件中${c.as_described}件`, en: `${c.as_described} of ${c.bought}`, zh: `${c.bought} 个中 ${c.as_described} 个` }[lang] + extra;
}

const price = (p: number | null, lang: Lang) => (p === null ? "—" : p === 0 ? (lang === "zh" ? "免费" : "Free") : lang === "zh" ? `$${p} 起` : `From $${p}`);

function Logo({ c }: { c: Card }) {
  if (c.logo) return <img src={c.logo} alt="" width={36} height={36} loading="lazy" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-1" />;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e9e7fb] text-[11px] font-bold text-[#3b2f9e]">{c.initials}</span>;
}

function CardRow({ c, onOpen, dup }: { c: Card; onOpen: () => void; dup: boolean }) {
  const { t, lang } = useLang();
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
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLE[c.badge]}`}>{t(BADGE_LABEL[c.badge])}</span>
          <p className="mt-1 text-[11px] text-white/45">
            {c.bought ? countText(c, lang) : notBoughtText(c, lang)}
            {c.bought ? ` · ${price(c.price_min, lang)}` : ""}
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
          {col.map((c) => (
            <CardRow key={c.operator} c={c} dup={names[c.name] > 1} onOpen={() => onOpen(c)} />
          ))}
        </ul>
      ))}
    </div>
  );
}

function OperatorDialog({ card, items, categories, onClose }: { card: Card | null; items: Item[]; categories: Category[] | undefined; onClose: () => void }) {
  const { t, lang } = useLang();
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        {card && (
          <>
            <DialogTitle className="flex items-center gap-3">
              <Logo c={card} />
              <span>{card.name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLE[card.badge]}`}>{t(BADGE_LABEL[card.badge])}</span>
            </DialogTitle>
            <DialogDescription>
              {t({
                ja: `${card.host} · x402 Endpoint の tx ${card.tx?.toLocaleString() ?? "—"}・buyer ${card.buyers?.toLocaleString() ?? "—"} · 買ったエンドポイント ${card.bought} 件中、説明どおり ${card.as_described} 件`,
                en: `${card.host} · x402 Endpoint tx ${card.tx?.toLocaleString() ?? "—"}, buyers ${card.buyers?.toLocaleString() ?? "—"} · ${card.as_described} of ${card.bought} endpoints bought were as described`,
                zh: `${card.host} · x402 Endpoint 的 tx ${card.tx?.toLocaleString() ?? "—"}、买家 ${card.buyers?.toLocaleString() ?? "—"} · 已购买的 ${card.bought} 个端点中，与说明一致的有 ${card.as_described} 个`,
              })}
            </DialogDescription>
            <div className="mt-2 space-y-3">
              {items.map((i) => (
                <div key={i.id} className="rounded-lg border bg-card/60 px-4 py-3">
                  <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${TONE[i.last?.category ?? ""] === "accent" ? BADGE_STYLE.as_described : "border-white/20 text-white/70"}`}
                    >
                      {categoryLabel(categories, i.last?.category, lang, t(BADGE_LABEL.not_bought))}
                    </span>
                    <span className="break-all text-white/80">
                      {i.last?.request?.method ?? ""} {new URL(i.url).pathname}
                    </span>
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
  const { t, lang } = useLang();
  const { d, err } = useCurated();
  const [open, setOpen] = useState<Card | null>(null);
  const cards = d?.cards ?? [];
  const shown = limit ? cards.slice(0, limit) : cards;
  const items = open && d ? d.items.filter((i) => open.item_ids.includes(i.id)) : [];
  const date = fmtDate(d?.summary.purchased_on ?? null, lang);
  return (
    <section
      id="purchases"
      className="relative overflow-hidden py-16 md:py-24"
      style={{
        backgroundColor: "rgb(12 12 12)",
        backgroundImage:
          "radial-gradient(60% 50% at 15% 0%, rgba(126,139,240,0.16), transparent 70%), radial-gradient(50% 45% at 90% 20%, rgba(245,124,230,0.10), transparent 70%), radial-gradient(60% 50% at 50% 100%, rgba(94,227,236,0.08), transparent 70%)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div className="relative mx-auto max-w-5xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-white">Seller Probe</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">
              {t({
                ja: "使われている API を、使い方どおりに買った結果",
                en: "APIs in real use, bought the way they are documented",
                zh: "按说明的方式购买正在被使用的 API 的结果",
              })}
            </h2>
            <p className="mt-2 text-sm text-white/55">
              {d
                ? t({
                    ja: `x402 Endpoint で使われている ${d.summary.operators} 事業者（${d.summary.endpoints} エンドポイント）を、実際に払って確かめた結果（${date}購入）。`,
                    en: `${d.summary.operators} sellers in use on x402 Endpoint (${d.summary.endpoints} endpoints), checked by actually paying them (bought ${date}).`,
                    zh: `对 x402 Endpoint 上正在被使用的 ${d.summary.operators} 个卖家（${d.summary.endpoints} 个端点）实际付款验证的结果（${date}购买）。`,
                  })
                : err
                  ? t({ ja: "結果を読み込めませんでした", en: "Could not load the results", zh: "无法加载结果" }) + `（${err}）`
                  : t({ ja: "読み込み中…", en: "Loading…", zh: "加载中…" })}
            </p>
          </div>
          {!full && (
            <a href="/purchases" className="inline-flex items-center gap-1.5 text-sm text-white/80 transition-colors hover:text-white">
              {t({ ja: "結果を全部見る", en: "See all results", zh: "查看全部结果" })}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M7 7h10v10" />
                <path d="M7 17 17 7" />
              </svg>
            </a>
          )}
        </div>
        {shown.length > 0 && <CardGrid cards={shown} onOpen={setOpen} />}
        <p className="mt-3 text-[11px] text-white/40">
          {t({
            ja: "1P は自社ドメインでの提供、3P は決済ゲートウェイ経由の提供です。",
            en: "1P is offered on the seller's own domain; 3P is offered through a payment gateway.",
            zh: "1P 为在自有域名上提供，3P 为通过支付网关提供。",
          })}
        </p>
        <p className="mt-1 text-[11px] text-white/40">
          {t({
            ja: "バッジは事業者ごとに、買ったエンドポイントのうち一番悪い結果です（説明どおり・説明と違う・届かなかった）。「N件中M件」は買った件数と、そのうち説明どおりに届いた件数。「送金なし」は送金が起きないまま届いたもので、失敗には数えていません。払わなかったもの（$0.01 超・使い方の公開なし・入力が合わない・Probe の入力不足）だけの事業者は未購入とし、理由をカードに出して後ろに並べます。カードを押すとエンドポイントごとの要求・応答・確認・tx を開きます。",
            en: "Each seller's badge is the worst result among the endpoints bought (as described, not as described, not delivered). “M of N” is how many of the N endpoints bought arrived as described. “Without payment” means it arrived with no transfer; it is not counted as a failure. Sellers where nothing was paid (above $0.01, no published usage, input did not fit, the Probe's input short) are marked not bought, with the reason on the card, and listed last. Open a card for each endpoint's request, response, checks and tx.",
            zh: "徽章表示每个卖家已购买端点中最差的结果（与说明一致、与说明不符、未送达）。“N 个中 M 个”表示已购买的数量及其中与说明一致送达的数量。“未付款”表示未发生转账却送达，不计为失败。只有未付款项（超过 $0.01、未公开调用方式、输入不符、Probe 输入不足）的卖家标为未购买，原因显示在卡片上并排在后面。点击卡片可查看各端点的请求、响应、检查和 tx。",
          })}
        </p>
      </div>
      <OperatorDialog card={open} items={items} categories={d?.categories} onClose={() => setOpen(null)} />
    </section>
  );
}
