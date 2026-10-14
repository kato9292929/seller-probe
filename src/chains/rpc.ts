export async function rpc<T = any>(url: string, method: string, params: unknown[], attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const j: any = await r.json();
      if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
      return j.result as T;
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 500 * 2 ** i));
    }
  }
  throw last;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
