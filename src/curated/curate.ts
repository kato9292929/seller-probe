// Choosing the endpoints worth measuring (targets/curated.json). Pure: every input is passed in,
// so the same data gives the same list, and every endpoint left out keeps the reason it was.
import { exclusionReason, loadExclusions } from "../exclusions.js";
import { USDC } from "../config.js";
import { type BazaarItem, type Operator, type Seller, hostOf } from "./sources.js";

export const PER_OPERATOR = 3;
export const MAX_ITEMS = 80;

export type CatalogEndpoint = { id: string; url: string; name: string | null; description: string | null; category: string | null; networks: string[]; source: string[]; source_url: string | null };

export type CuratedItem = {
  id: string; // the x402 Endpoint id when the URL is in its catalog, else a hash of the URL
  operator: string; // operator key: the x402scan seller (payTo group) or the host
  operator_name: string;
  host: string;
  url: string;
  name: string | null;
  description: string | null;
  category: string | null;
  price_usd: number | null; // from the Bazaar accept (official USDC), null when unknown
  network: string | null;
  pay_to: string | null;
  /** Why this endpoint is on the list. */
  reasons: {
    listed_in: string[]; // which x402 Endpoint tables named the operator
    operator_tx: number | null;
    operator_buyers: number | null;
    operator_stats_source: string; // "x402 Endpoint Most-called (x402scan)" / "x402scan sellers, 7 days" / "none"
    endpoint_calls_30d: number | null;
    endpoint_payers_30d: number | null;
    endpoint_stats_source: string; // "CDP Bazaar quality (30 days)" / "none: not in the Bazaar"
  };
  /** The Bazaar's usage definition, kept so the weekly purchase does not refetch the Bazaar. */
  bazaar: Pick<BazaarItem, "input" | "inputSchema" | "output" | "outputSchema"> | null;
  x402_endpoint_id: string | null;
};

export type Exclusion = { scope: "operator" | "endpoint"; host: string; url?: string; operator?: string; reason: string; detail: string };

export type CuratedFile = {
  generated_at: string;
  sources: Record<string, string>;
  rules: string[];
  candidates: { operators: number; endpoints: number };
  excluded: Exclusion[];
  excluded_counts: Record<string, number>;
  cut_at_max: number;
  items: CuratedItem[];
};

// Reason codes (definitions on the page; Japanese labels in web/).
export const REASONS = {
  single_buyer: "buyer が 1",
  self_trade: "買い手の address が payTo と同じ（自己取引）",
  test_demo: "名前・説明に test / demo / example",
  reward_or_resale: "報酬キャンペーン・転売のみ",
  excluded_list: "除外リスト（くじ・賭博など）",
  same_pay_to: "同じ payTo の別ホスト（同じ運営者として数える）",
  per_operator_cap: "1運営者あたり3件を超えた",
  template_url: "URL がテンプレート（{id} や /:param）",
  no_endpoint: "エンドポイントが見つからない",
  over_max: "80件を超えた（tx の少ない順に切った）",
} as const;
export type ReasonCode = keyof typeof REASONS;

const TEST_RE = /\b(test(net|ing)?|demo|example|sample|sandbox|playground|hello[- ]?world|dummy|mock)\b/i;
const REWARD_RE = /\b(quests?|earn(ing)?|rewards?|airdrops?|points?|campaigns?|faucet|referral|giveaway|contests?)\b/i;
const RESALE_RE = /\b(resell(er|ing)?|resale|proxy for|re-?sells?|wrapper (around|for)|mirrors?)\b/i;
/** A payTo spread over this many hosts with this few buyers is a resale front, not a service bought by others. */
export const RESALE_GROUP_HOSTS = 10;
export const RESALE_GROUP_BUYERS = 5;
const TEMPLATE_RE = /%7B|%7D|[{}]|\/:[A-Za-z_]/i;

const usd = (amount: string | null) => (amount && /^\d+$/.test(amount) ? Number(amount) / 1e6 : null);
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};

/** The accept the probe would pay: official USDC on Base or Solana, cheapest first. */
export function usdcAccept(b: BazaarItem) {
  const ok = b.accepts.filter((a) => a.scheme === "exact" && a.asset && (a.asset.toLowerCase() === USDC.base.toLowerCase() || a.asset === USDC.solana));
  return ok.sort((x, y) => Number(BigInt(x.amount ?? "0") - BigInt(y.amount ?? "0")))[0] ?? null;
}

export type CurateInput = {
  operators: Operator[];
  bazaar: BazaarItem[];
  sellers: Map<string, Seller>;
  catalog: CatalogEndpoint[];
  /** host → address seen paying itself (buyer = payTo), from the chain; absent = not seen / not checked. */
  selfTrade: Map<string, { address: string; tx: string }>;
  exclusions?: ReturnType<typeof loadExclusions>;
  now?: Date;
  sources?: Record<string, string>;
};

export function curate(inp: CurateInput): CuratedFile {
  const ex = inp.exclusions ?? loadExclusions();
  const excluded: Exclusion[] = [];
  const drop = (e: Exclusion) => excluded.push(e);

  // Operators: one row per host, merging the tables that name it.
  const byHost = new Map<string, { op: Operator; listed: Set<string> }>();
  for (const o of inp.operators) {
    const cur = byHost.get(o.host);
    if (!cur) byHost.set(o.host, { op: { ...o }, listed: new Set([o.source]) });
    else {
      cur.listed.add(o.source);
      if (o.source === "most_called") cur.op = { ...o, name: o.name };
    }
  }
  const bazaarBy = new Map<string, BazaarItem[]>();
  for (const b of inp.bazaar) (bazaarBy.get(b.host) ?? bazaarBy.set(b.host, []).get(b.host)!).push(b);
  const catalogBy = new Map<string, CatalogEndpoint[]>();
  for (const c of inp.catalog) {
    const h = hostOf(c.url);
    if (h) (catalogBy.get(h) ?? catalogBy.set(h, []).get(h)!).push(c);
  }
  const catalogByUrl = new Map(inp.catalog.map((c) => [c.url, c]));

  type Op = { host: string; name: string; listed: string[]; tx: number | null; buyers: number | null; statsSource: string; category: string | null; seller: Seller | undefined; key: string };
  const ops: Op[] = [];
  for (const { op, listed } of byHost.values()) {
    const seller = inp.sellers.get(op.host);
    const mc = op.source === "most_called";
    ops.push({
      host: op.host, name: op.name, listed: [...listed].sort(), category: op.category, seller,
      tx: mc ? op.tx_count : (seller?.tx_count ?? null),
      buyers: mc ? op.buyers : (seller?.unique_buyers ?? null),
      statsSource: mc ? "x402 Endpoint Most-called (x402scan)" : seller ? "x402scan sellers, 7 days" : "none",
      // Hosts x402scan groups under one seller (the same payTo) are one operator.
      key: seller && seller.recipients.length ? `payto:${[...seller.recipients].sort()[0]}` : `host:${op.host}`,
    });
  }
  ops.sort((a, b) => (b.tx ?? -1) - (a.tx ?? -1) || a.host.localeCompare(b.host));
  const candidateEndpoints = ops.reduce((n, o) => n + (bazaarBy.get(o.host)?.length || catalogBy.get(o.host)?.length || 0), 0);

  // Operator-level exclusions.
  const seenKey = new Map<string, string>();
  const keptOps: Op[] = [];
  for (const o of ops) {
    const text = [o.name, ...(o.seller?.titles ?? []), ...(o.seller?.descriptions ?? [])].join(" \n ");
    const listedEx = exclusionReason({ host: o.host, url: `https://${o.host}/` }, ex);
    const st = inp.selfTrade.get(o.host);
    const reason: [ReasonCode, string] | null =
      listedEx ? ["excluded_list", listedEx]
      : o.buyers === 1 ? ["single_buyer", `buyers = 1 (${o.statsSource})`]
      : st ? ["self_trade", `${st.address} paid its own payTo (tx ${st.tx})`]
      : TEST_RE.test(`${o.host} ${o.name}`) ? ["test_demo", `name/host matches "${(`${o.host} ${o.name}`.match(TEST_RE) ?? [""])[0]}"`]
      : REWARD_RE.test(text) ? ["reward_or_resale", `description matches "${(text.match(REWARD_RE) ?? [""])[0]}"`]
      : RESALE_RE.test(text) ? ["reward_or_resale", `description matches "${(text.match(RESALE_RE) ?? [""])[0]}"`]
      : (o.seller?.hosts.length ?? 0) >= RESALE_GROUP_HOSTS && (o.seller?.unique_buyers ?? Infinity) <= RESALE_GROUP_BUYERS
        ? ["reward_or_resale", `one payTo across ${o.seller!.hosts.length} hosts with ${o.seller!.unique_buyers} buyer(s) (x402scan seller)`]
      : seenKey.has(o.key) ? ["same_pay_to", `same x402scan seller (payTo) as ${seenKey.get(o.key)}`]
      : null;
    if (reason) {
      drop({ scope: "operator", host: o.host, operator: o.name, reason: reason[0], detail: reason[1] });
      continue;
    }
    seenKey.set(o.key, o.host);
    keptOps.push(o);
  }

  // Endpoints per operator: the Bazaar's resources by 30-day calls; the x402 Endpoint catalog when
  // the operator is not in the Bazaar (no per-endpoint counts then).
  let items: CuratedItem[] = [];
  for (const o of keptOps) {
    const pool: { url: string; b: BazaarItem | null; c: CatalogEndpoint | null }[] = (bazaarBy.get(o.host) ?? [])
      .slice().sort((x, y) => (y.calls30d ?? -1) - (x.calls30d ?? -1) || x.resource.localeCompare(y.resource))
      .map((b) => ({ url: b.resource, b, c: catalogByUrl.get(b.resource) ?? null }));
    if (!pool.length) for (const c of catalogBy.get(o.host) ?? []) pool.push({ url: c.url, b: null, c });
    const seen = new Set<string>();
    let n = 0;
    let capped = 0;
    for (const { url, b, c } of pool) {
      if (seen.has(url)) continue;
      seen.add(url);
      const text = `${url} ${b?.description ?? c?.description ?? ""} ${c?.name ?? ""}`;
      const why: [ReasonCode, string] | null =
        TEMPLATE_RE.test(url) ? ["template_url", url]
        : exclusionReason({ host: o.host, url }, ex) ? ["excluded_list", exclusionReason({ host: o.host, url }, ex)!]
        : b?.payers30d === 1 ? ["single_buyer", "Bazaar l30DaysUniquePayers = 1"]
        : TEST_RE.test(text) ? ["test_demo", `matches "${(text.match(TEST_RE) ?? [""])[0]}"`]
        : REWARD_RE.test(text) ? ["reward_or_resale", `matches "${(text.match(REWARD_RE) ?? [""])[0]}"`]
        : n >= PER_OPERATOR ? ["per_operator_cap", `operator already has ${PER_OPERATOR}`]
        : null;
      if (why) {
        // The per-operator cap is not listed one by one (an operator can have thousands).
        if (why[0] === "per_operator_cap") capped++;
        else drop({ scope: "endpoint", host: o.host, url, operator: o.name, reason: why[0], detail: why[1] });
        continue;
      }
      n++;
      const acc = b ? usdcAccept(b) : null;
      items.push({
        id: c?.id ?? `u_${fnv(url)}`, operator: o.key, operator_name: o.name, host: o.host, url,
        name: c?.name ?? b?.serviceName ?? null, description: b?.description ?? c?.description ?? null, category: c?.category ?? o.category,
        price_usd: acc ? usd(acc.amount) : null, network: acc?.network ?? null, pay_to: acc?.payTo ?? null,
        reasons: {
          listed_in: o.listed, operator_tx: o.tx, operator_buyers: o.buyers, operator_stats_source: o.statsSource,
          endpoint_calls_30d: b?.calls30d ?? null, endpoint_payers_30d: b?.payers30d ?? null,
          endpoint_stats_source: b ? "CDP Bazaar quality (30 days)" : "none: not in the Bazaar",
        },
        bazaar: b ? { input: b.input, inputSchema: b.inputSchema, output: b.output, outputSchema: b.outputSchema } : null,
        x402_endpoint_id: c?.id ?? null,
      });
    }
    if (!pool.length) drop({ scope: "operator", host: o.host, operator: o.name, reason: "no_endpoint", detail: "no resource in the Bazaar or the x402 Endpoint catalog" });
    if (capped > 0) drop({ scope: "endpoint", host: o.host, operator: o.name, reason: "per_operator_cap", detail: `${capped} more endpoint(s) not taken (kept the ${PER_OPERATOR} with the most calls)` });
  }

  // Above 80: keep the most-called. Endpoint calls when known, else the operator's tx.
  const weight = (i: CuratedItem) => i.reasons.endpoint_calls_30d ?? i.reasons.operator_tx ?? -1;
  items.sort((a, b) => weight(b) - weight(a) || (b.reasons.operator_tx ?? -1) - (a.reasons.operator_tx ?? -1) || a.url.localeCompare(b.url));
  for (const i of items.slice(MAX_ITEMS)) drop({ scope: "endpoint", host: i.host, url: i.url, operator: i.operator_name, reason: "over_max", detail: `weight ${weight(i)}` });
  items = items.slice(0, MAX_ITEMS);

  const excluded_counts: Record<string, number> = {};
  for (const e of excluded) excluded_counts[e.reason] = (excluded_counts[e.reason] ?? 0) + 1;
  return {
    generated_at: (inp.now ?? new Date()).toISOString(),
    sources: inp.sources ?? {},
    rules: [
      "運営者 = x402 Endpoint の Most-called 上位50・自社ドメインの13社・その他16社に載ったホスト。x402scan が同じ payTo でまとめるホストは1運営者。",
      `除外: buyer が 1／買い手 = payTo（Base の USDC 送金で確認）／test・demo・example／報酬キャンペーン・転売のみ（説明の語、または1つの payTo が${RESALE_GROUP_HOSTS}ホスト以上にまたがり buyer が${RESALE_GROUP_BUYERS}以下）／除外リスト。`,
      `1運営者あたり最大${PER_OPERATOR}件。Bazaar の30日呼び出し数の多い順。Bazaar に無い運営者は x402 Endpoint のカタログから（エンドポイント単位の件数なし）。`,
      `全体で${MAX_ITEMS}件を超えたら、エンドポイントの呼び出し数（無ければ運営者の tx 数）の多い順に${MAX_ITEMS}件。`,
    ],
    candidates: { operators: ops.length, endpoints: candidateEndpoints },
    excluded, excluded_counts, cut_at_max: MAX_ITEMS, items,
  };
}
