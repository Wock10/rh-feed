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

  async request(pathname, { params = {}, method = "GET", body } = {}) {
    const url = new URL(`${API}${pathname}`);
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
    let lastErr = null;
    for (let attempt = 0; attempt < Math.max(3, this.keys.length); attempt++) {
      const key = this.nextKey();
      const res = await fetch(url, {
        method,
        cache: "no-store",
        headers: {
          accept: "application/json",
          "x-api-key": key,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
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

  async get(pathname, params = {}) {
    return this.request(pathname, { params });
  }

  async post(pathname, body) {
    return this.request(pathname, { method: "POST", body });
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

  async getCollectionStats(slug) {
    return this.get(`/collections/${encodeURIComponent(slug)}/stats`);
  }

  async getAccount(address) {
    try {
      return await this.get(`/accounts/${encodeURIComponent(address)}`);
    } catch (err) {
      if (String(err.message).includes("404")) return null;
      throw err;
    }
  }

  async listAccountEvents(address, { chain = "robinhood", eventType, limit = 50, next } = {}) {
    const data = await this.get(`/events/accounts/${encodeURIComponent(address)}`, {
      chain,
      limit,
      next,
      event_type: eventType,
    });
    return {
      events: Array.isArray(data?.asset_events) ? data.asset_events : [],
      next: data?.next ?? null,
    };
  }

  async listNewestCollections(chain, { limit = 40 } = {}) {
    const data = await this.get("/collections", {
      chain,
      limit,
      order_by: "created_date",
    });
    return data?.collections ?? [];
  }

  async listDrops({ type = "featured", chains, limit = 50, cursor } = {}) {
    const data = await this.get("/drops", {
      type,
      limit,
      chains,
      cursor,
    });
    return {
      drops: Array.isArray(data?.drops) ? data.drops : [],
      next: data?.next ?? null,
    };
  }

  async getDrop(slug) {
    try {
      return await this.get(`/drops/${encodeURIComponent(slug)}`);
    } catch (err) {
      if (String(err.message).includes("404")) return null;
      throw err;
    }
  }

  async checkMintEligibility(slug, minter, quantity = 1) {
    try {
      const data = await this.post(`/drops/${encodeURIComponent(slug)}/mint`, {
        minter,
        quantity,
      });
      return {
        eligible: true,
        reason: null,
        value: data?.value ?? "0",
      };
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (/not eligible/i.test(msg)) {
        return { eligible: false, reason: "not eligible" };
      }
      if (/fully minted|sold out|no .*supply|insufficient supply/i.test(msg)) {
        return { eligible: false, reason: "minted out" };
      }
      if (/insufficient balance/i.test(msg)) {
        return { eligible: true, reason: "low balance" };
      }
      if (/OpenSea 404/.test(msg)) {
        return { eligible: false, reason: "no drop" };
      }
      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
