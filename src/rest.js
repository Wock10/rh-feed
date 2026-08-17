const API = "https://api.opensea.io/api/v2";

function splitKeys(env) {
  const multi = env.OPENSEA_API_KEYS ?? "";
  const one = env.OPENSEA_API_KEY ?? "";
  const keys = [
    ...multi.split(/[,;\s]+/),
    one,
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

export class OpenSeaRest {
  constructor(env) {
    this.keys = splitKeys(env);
    this.i = 0;
    this.remaining = new Map(this.keys.map((k) => [k, 120]));
  }

  get hasKeys() {
    return this.keys.length > 0;
  }

  nextKey() {
    if (!this.keys.length) throw new Error("OPENSEA_API_KEY is required");
    const start = this.i;
    do {
      const key = this.keys[this.i % this.keys.length];
      this.i += 1;
      if ((this.remaining.get(key) ?? 1) > 0) return key;
    } while (this.i % this.keys.length !== start % this.keys.length);
    return this.keys[0];
  }

  async get(pathname, params = {}) {
    const url = new URL(`${API}${pathname}`);
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
    let lastErr = null;
    for (let attempt = 0; attempt < Math.max(3, this.keys.length); attempt++) {
      const key = this.nextKey();
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json", "x-api-key": key },
      });
      const limit = Number(res.headers.get("x-ratelimit-remaining"));
      if (Number.isFinite(limit)) this.remaining.set(key, limit);
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after") ?? 1);
        lastErr = new Error(`OpenSea 429`);
        await sleep(Math.max(400, retry * 1000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`OpenSea ${res.status}: ${text.slice(0, 240)}`);
      }
      return text ? JSON.parse(text) : null;
    }
    throw lastErr ?? new Error("OpenSea REST failed");
  }

  async listChainCollections(chain, { maxPages = 4, limit = 100 } = {}) {
    const out = [];
    const seen = new Set();
    const add = (rows) => {
      for (const row of rows ?? []) {
        const slug = row.collection || row.slug;
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        out.push(row);
      }
    };
    try {
      const hot = await this.get("/collections", {
        chain,
        limit,
        order_by: "seven_day_volume",
      });
      add(hot.collections);
    } catch (err) {
      console.warn("hot collections failed:", err.message);
    }
    let next = null;
    for (let page = 0; page < maxPages; page++) {
      const data = await this.get("/collections", {
        chain,
        limit,
        ...(next ? { next } : {}),
      });
      add(data?.collections);
      next = data?.next ?? null;
      if (!next) break;
    }
    return out;
  }

  async getCollection(slug) {
    return this.get(`/collections/${encodeURIComponent(slug)}`);
  }

  async getAccount(address) {
    try {
      return await this.get(`/accounts/${encodeURIComponent(address)}`);
    } catch (err) {
      if (String(err.message).includes("404")) return null;
      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
