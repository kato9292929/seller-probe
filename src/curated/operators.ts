// Operator cards for the top of the page: one card per curated operator, with its name, 1P/3P,
// logo (targets/operators.json, written by `npm run logos`) and the result of its purchases.
// Pure: no I/O.

/** A service in kato9292929/endpoint's data/services.json (the source x402jp.com uses). */
export type OfficialService = {
  slug: string; name: string; party: "1P" | "3P"; domain: string | null; category: string | null;
  hosts: string[]; via: string[]; logo: string | null;
};

export type OperatorMeta = {
  operator: string; slug: string; name: string; party: "1P" | "3P"; via: string[]; domain: string | null; category: string | null;
  official_slug: string | null;
  /** /logos/<file> in web/public, or null for an initials tile. */
  logo: string | null;
  logo_source: "official" | "domain" | "initials";
};

const norm = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** The official service that lists one of these hosts (1P before 3P), else null. */
export function matchOfficial(hosts: string[], services: OfficialService[]): OfficialService | null {
  const want = new Set(hosts.map(norm));
  const hits = services.filter((s) => s.hosts.some((h) => want.has(norm(h))));
  return hits.find((s) => s.party === "1P") ?? hits[0] ?? null;
}

/** The registrable domain, roughly: the last two labels (three for a two-letter second level like co.jp). */
/** Shared hosting: a subdomain there is the operator's own deployment, so the whole host is its "domain". */
const HOSTING = /\.(vercel\.app|workers\.dev|pages\.dev|railway\.app|netlify\.app|onrender\.com|herokuapp\.com|fly\.dev|deno\.dev|replit\.app|github\.io)$/;

export function registrable(host: string): string {
  if (HOSTING.test(norm(host))) return norm(host);
  const p = norm(host).split(".");
  const n = p.length >= 3 && p[p.length - 2].length <= 3 && p[p.length - 1].length === 2 ? 3 : 2;
  return p.slice(-n).join(".");
}

export const slugOf = (host: string) => norm(host).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Initials for a tile: two letters, as the official site's "OP" for OpenAI. */
export const initials = (name: string) => (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?").toUpperCase();

/** The result badge, from the worst category among the operator's purchases. */
export type Badge = "as_described" | "not_as_described" | "not_delivered" | "not_bought";
export const BADGES: Record<Badge, string> = {
  as_described: "説明どおり",
  not_as_described: "説明と違う",
  not_delivered: "届かなかった",
  not_bought: "未購入",
};
const NOT_DELIVERED = new Set(["paid_not_delivered", "paid_then_rejected", "not_settled"]);
/** Not bought: the Probe sent no payment (price over the cap, no usage, input mismatch, balance/caps). */
export const NOT_BOUGHT = new Set(["over_price", "no_usage", "input_mismatch", "not_bought"]);

export function badgeOf(categories: (string | null)[]): Badge {
  const cs = categories.filter((c): c is string => !!c);
  if (cs.some((c) => NOT_DELIVERED.has(c))) return "not_delivered";
  if (cs.some((c) => c === "not_as_described")) return "not_as_described";
  if (!cs.length || cs.every((c) => NOT_BOUGHT.has(c))) return "not_bought";
  // Only "as described" (and delivered-without-payment, which still delivered) among those bought.
  return "as_described";
}

type ItemIn = {
  id: string; operator_key: string; host: string; url: string; price_usd: number | null; category: string | null;
  reasons: { operator_tx: number | null; operator_buyers: number | null };
  last: { category: string | null } | null;
};

export type OperatorCard = {
  operator: string; slug: string; name: string; party: "1P" | "3P"; via: string | null; host: string; domain: string | null; category: string | null;
  logo: string | null; logo_source: OperatorMeta["logo_source"]; initials: string;
  badge: Badge; badge_label: string;
  endpoints: number; bought: number; as_described: number; price_min: number | null;
  /** Delivered although no transfer happened (counted apart from "as described"). */
  delivered_without_payment: number;
  /** Why nothing was bought, when nothing was: "$0.01 超（$0.75）", "使い方の公開なし", "入力が合わない". */
  not_bought_reason: string | null;
  tx: number | null; buyers: number | null;
  item_ids: string[];
};

const NOT_BOUGHT_LABEL: Record<string, string> = { no_usage: "使い方の公開なし", input_mismatch: "入力が合わない", not_bought: "残高・上限で見送り" };

function notBoughtReason(its: ItemIn[]): string {
  const out: string[] = [];
  const over = its.filter((i) => i.last?.category === "over_price");
  if (over.length || !its.some((i) => i.last)) {
    const p = over.map((i) => i.price_usd).filter((x): x is number => typeof x === "number");
    if (over.length) out.push(`$0.01 超${p.length ? `（$${Math.min(...p)}）` : ""}`);
  }
  for (const c of ["no_usage", "input_mismatch", "not_bought"]) if (its.some((i) => i.last?.category === c)) out.push(NOT_BOUGHT_LABEL[c]);
  return out.join("・") || "まだ購入していない";
}

const titleCase = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

/** One card per operator, ordered by the operator's x402 Endpoint tx count (most first). */
export function operatorCards(items: ItemIn[], metas: OperatorMeta[]): OperatorCard[] {
  const metaBy = new Map(metas.map((m) => [m.operator, m]));
  const groups = new Map<string, ItemIn[]>();
  for (const i of items) (groups.get(i.operator_key) ?? groups.set(i.operator_key, []).get(i.operator_key)!).push(i);
  const cards: OperatorCard[] = [];
  for (const [key, its] of groups) {
    const m = metaBy.get(key);
    const first = its[0];
    const name = m?.name ?? first.host;
    const cats = its.map((i) => i.last?.category ?? null);
    const prices = its.map((i) => i.price_usd).filter((p): p is number => typeof p === "number");
    cards.push({
      operator: key, slug: m?.slug ?? slugOf(first.host), name, party: m?.party ?? "1P", via: m?.party === "3P" ? (m.via[0] ?? null) : null,
      host: first.host, domain: m?.domain ?? registrable(first.host), category: titleCase(m?.category ?? first.category),
      logo: m?.logo ?? null, logo_source: m?.logo_source ?? "initials", initials: initials(name),
      badge: badgeOf(cats), badge_label: BADGES[badgeOf(cats)],
      endpoints: its.length, bought: cats.filter((c) => c && !NOT_BOUGHT.has(c)).length, as_described: cats.filter((c) => c === "as_described").length,
      price_min: prices.length ? Math.min(...prices) : null,
      delivered_without_payment: cats.filter((c) => c === "delivered_without_payment").length,
      not_bought_reason: badgeOf(cats) === "not_bought" ? notBoughtReason(its) : null,
      tx: first.reasons.operator_tx, buyers: first.reasons.operator_buyers,
      item_ids: its.map((i) => i.id),
    });
  }
  // Operators the Probe actually bought from come first (by tx), then the ones it could not buy.
  return cards.sort((a, b) => Number(a.badge === "not_bought") - Number(b.badge === "not_bought") || (b.tx ?? -1) - (a.tx ?? -1) || a.name.localeCompare(b.name));
}
