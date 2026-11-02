// Upstash Redis over REST (no SDK), for the little state the Probe keeps outside git:
// buyer reports (POST /reports) and monitor registrations (POST /monitor). Configured with
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or Vercel's KV_REST_API_URL / KV_REST_API_TOKEN).
const TIMEOUT_MS = 3000;

export function kvConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export type Kv = { pipeline(commands: (string | number)[][]): Promise<unknown[]> };

export function upstash(cfg = kvConfig(), fetchImpl: typeof fetch = fetch): Kv | null {
  if (!cfg) return null;
  return {
    async pipeline(commands) {
      const res = await fetchImpl(`${cfg.url}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`kv: HTTP ${res.status}`);
      const out = (await res.json()) as { result?: unknown; error?: string }[];
      const err = out.find((r) => r.error);
      if (err) throw new Error(`kv: ${err.error}`);
      return out.map((r) => r.result);
    },
  };
}

/** In-memory stand-in with the same commands, for tests. */
export function memoryKv(): Kv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const hash = (k: string) => (data.get(k) as Map<string, string>) ?? data.set(k, new Map()).get(k) as Map<string, string>;
  const set = (k: string) => (data.get(k) as Set<string>) ?? data.set(k, new Set()).get(k) as Set<string>;
  const list = (k: string) => (data.get(k) as string[]) ?? data.set(k, []).get(k) as string[];
  return {
    data,
    async pipeline(commands) {
      return commands.map(([cmd, key, ...a]) => {
        const k = String(key);
        switch (String(cmd).toUpperCase()) {
          case "SET": data.set(k, String(a[0])); return "OK";
          case "GET": return (data.get(k) as string) ?? null;
          case "DEL": return data.delete(k) ? 1 : 0;
          case "INCR": { const v = Number(data.get(k) ?? 0) + 1; data.set(k, String(v)); return v; }
          case "HINCRBY": { const h = hash(k); const v = Number(h.get(String(a[0])) ?? 0) + Number(a[1]); h.set(String(a[0]), String(v)); return v; }
          case "HGETALL": return [...hash(k).entries()].flat();
          case "HLEN": return hash(k).size;
          case "SADD": { const s = set(k); const had = s.has(String(a[0])); s.add(String(a[0])); return had ? 0 : 1; }
          case "SREM": return set(k).delete(String(a[0])) ? 1 : 0;
          case "SMEMBERS": return [...set(k)];
          case "RPUSH": return list(k).push(String(a[0]));
          case "LRANGE": return list(k).slice(Number(a[0]), Number(a[1]) === -1 ? undefined : Number(a[1]) + 1);
          case "EXPIRE": return 1;
          default: throw new Error(`memoryKv: ${cmd}`);
        }
      });
    },
  };
}
