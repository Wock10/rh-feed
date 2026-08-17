const ZERO = "0x0000000000000000000000000000000000000000";
const EXCLUDE = new Set([
  ZERO,
  "0xe302733accf4800146e55fc45b46b4e4ffc032d2",
]);

const EARLY_MS = 12 * 60 * 1000;
const EARLY_SALES = 15;
const PUMP_MULT = 2.2;
const PUMP_MIN_SALES = 8;
const PUMP_MIN_AGE_MS = 8 * 60 * 1000;
const MAX_WALLETS = 900;
const MAX_COLLECTIONS = 500;
const MAX_EARLY_PRICES = 12;
const MAX_MARK_PRICES = 8;
const MAX_BAGS_SHOWN = 3;

function usdOf(event) {
  const n = Number(event.price?.usd);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function median(values) {
  const rows = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!rows.length) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}

function tokenKey(event) {
  if (event.tokenId != null && event.tokenId !== "") {
    return `${event.contract || event.slug}:${event.tokenId}`;
  }
  return event.id;
}

function isWallet(addr) {
  return Boolean(addr) && addr.startsWith("0x") && !EXCLUDE.has(addr);
}

export class TraderTracker {
  constructor() {
    /** @type {Map<string, object>} */
    this.collections = new Map();
    /** @type {Map<string, object>} */
    this.wallets = new Map();
    this.stats = {
      sales: 0,
      mints: 0,
      pumps: 0,
      wallets: 0,
      lastPersistAt: 0,
    };
  }

  ingest(event) {
    if (!event?.slug) return;
    if (event.type === "mint") {
      this.stats.mints += 1;
      this.touchCollection(event, null);
      this.recordBuy(event, event.to, 0, true);
      return;
    }
    if (event.type !== "sale") return;
    this.stats.sales += 1;
    const usd = usdOf(event);
    this.touchCollection(event, usd);
    if (event.from && event.from === event.to) return;
    if (usd == null) return;
    this.recordSell(event, event.from, usd);
    this.recordBuy(event, event.to, usd, false);
  }

  setAccount(address, profile) {
    const wallet = this.wallets.get(address);
    if (!wallet || !profile) return;
    if (profile.name) wallet.name = profile.name;
    if (profile.url) wallet.url = profile.url;
    if (profile.image) wallet.image = profile.image;
  }

  touchCollection(event, usd) {
    let col = this.collections.get(event.slug);
    if (!col) {
      col = {
        slug: event.slug,
        name: event.collectionName || event.slug,
        image: event.image || null,
        firstTs: event.ts,
        lastTs: event.ts,
        sales: 0,
        earlyUsd: [],
        recentUsd: [],
        pumped: false,
        pumpedAt: 0,
        multiple: 1,
      };
      this.collections.set(event.slug, col);
    }
    if (event.collectionName) col.name = event.collectionName;
    if (event.image && !col.image) col.image = event.image;
    col.lastTs = event.ts;
    if (event.ts < col.firstTs) col.firstTs = event.ts;
    if (usd == null) return col;
    col.sales += 1;
    if (col.earlyUsd.length < MAX_EARLY_PRICES) col.earlyUsd.push(usd);
    col.recentUsd.push(usd);
    if (col.recentUsd.length > MAX_MARK_PRICES) col.recentUsd.shift();
    this.refreshPump(col, event.ts);
    return col;
  }

  refreshPump(col, now) {
    const early = median(col.earlyUsd);
    const mark = median(col.recentUsd);
    col.earlyMedian = early;
    col.mark = mark;
    if (!early || !mark || early <= 0) return;
    const multiple = mark / early;
    col.multiple = Math.round(multiple * 10) / 10;
    const age = now - col.firstTs;
    const shouldPump =
      !col.pumped &&
      col.sales >= PUMP_MIN_SALES &&
      age >= PUMP_MIN_AGE_MS &&
      multiple >= PUMP_MULT;
    if (!shouldPump) return;
    col.pumped = true;
    col.pumpedAt = now;
    this.stats.pumps += 1;
    for (const wallet of this.wallets.values()) {
      if (wallet.earlyBuys.has(col.slug)) wallet.hits.add(col.slug);
    }
  }

  wallet(address) {
    if (!isWallet(address)) return null;
    let row = this.wallets.get(address);
    if (!row) {
      row = {
        address,
        name: null,
        url: `https://opensea.io/${address}`,
        image: null,
        buys: 0,
        sells: 0,
        mints: 0,
        realizedUsd: 0,
        untrackedSells: 0,
        lastTs: 0,
        earlyBuys: new Set(),
        hits: new Set(),
        collections: new Set(),
        bags: new Map(),
      };
      this.wallets.set(address, row);
      this.stats.wallets = this.wallets.size;
    }
    return row;
  }

  bagMap(wallet, slug) {
    let bags = wallet.bags.get(slug);
    if (!bags) {
      bags = new Map();
      wallet.bags.set(slug, bags);
    }
    return bags;
  }

  isEarly(col, event) {
    if (!col) return true;
    const age = event.ts - col.firstTs;
    return col.sales <= EARLY_SALES || age <= EARLY_MS;
  }

  recordBuy(event, address, costUsd, isMint) {
    const wallet = this.wallet(address);
    if (!wallet) return;
    const col = this.collections.get(event.slug);
    wallet.lastTs = event.ts;
    wallet.collections.add(event.slug);
    if (isMint) wallet.mints += 1;
    else wallet.buys += 1;
    if (event.toName) {
      wallet.name = event.toName;
      if (event.toUrl) wallet.url = event.toUrl;
    }
    if (event.toImage) wallet.image = event.toImage;
    const early = this.isEarly(col, event);
    if (early) {
      wallet.earlyBuys.add(event.slug);
      if (col.pumped) wallet.hits.add(event.slug);
    }
    const bags = this.bagMap(wallet, event.slug);
    bags.set(tokenKey(event), {
      costUsd: costUsd ?? 0,
      ts: event.ts,
      early,
      qty: event.quantity ?? 1,
    });
  }

  recordSell(event, address, saleUsd) {
    const wallet = this.wallet(address);
    if (!wallet) return;
    wallet.lastTs = event.ts;
    wallet.sells += 1;
    wallet.collections.add(event.slug);
    if (event.fromName) {
      wallet.name = event.fromName;
      if (event.fromUrl) wallet.url = event.fromUrl;
    }
    if (event.fromImage) wallet.image = event.fromImage;
    const bags = wallet.bags.get(event.slug);
    const key = tokenKey(event);
    const lot = bags?.get(key);
    if (!lot) {
      wallet.untrackedSells += 1;
      return;
    }
    bags.delete(key);
    if (!bags.size) wallet.bags.delete(event.slug);
    wallet.realizedUsd += saleUsd - (lot.costUsd ?? 0);
  }

  board({ mutes, limit = 12 } = {}) {
    const muted = mutes instanceof Set ? mutes : new Set(mutes ?? []);
    const now = Date.now();
    const rows = [];
    for (const wallet of this.wallets.values()) {
      const bags = [];
      let upnlUsd = 0;
      let openQty = 0;
      for (const [slug, tokens] of wallet.bags) {
        if (muted.has(slug)) continue;
        const col = this.collections.get(slug);
        const mark = col?.mark;
        let qty = 0;
        let cost = 0;
        let bagUpnl = 0;
        for (const lot of tokens.values()) {
          qty += lot.qty || 1;
          cost += lot.costUsd ?? 0;
          if (mark != null) bagUpnl += mark * (lot.qty || 1) - (lot.costUsd ?? 0);
        }
        openQty += qty;
        upnlUsd += bagUpnl;
        bags.push({
          slug,
          name: col?.name || slug,
          qty,
          upnl: Math.round(bagUpnl * 100) / 100,
          pumped: Boolean(col?.pumped),
          multiple: col?.multiple ?? null,
          hot: Boolean(col?.pumped) || (col?.multiple ?? 1) >= 1.6,
        });
      }
      const hits = [...wallet.hits].filter((slug) => !muted.has(slug));
      const plays = [...wallet.earlyBuys].filter((slug) => !muted.has(slug));
      if (
        !hits.length &&
        plays.length === 0 &&
        wallet.collections.size < 2 &&
        wallet.realizedUsd < 15 &&
        upnlUsd < 15
      ) {
        continue;
      }
      bags.sort((a, b) => Number(b.hot) - Number(a.hot) || b.upnl - a.upnl);
      const realizedUsd = Math.round(wallet.realizedUsd * 100) / 100;
      const upnl = Math.round(upnlUsd * 100) / 100;
      const hitRate = plays.length ? hits.length / plays.length : 0;
      const hotBags = bags.filter((b) => b.hot).length;
      const score =
        hits.length * 70 +
        Math.max(realizedUsd, 0) * 0.25 +
        Math.max(upnl, 0) * 0.15 +
        hotBags * 28 +
        Math.min(wallet.collections.size, 12) * 4 +
        (hitRate >= 0.35 ? 20 : 0) -
        (wallet.buys > 90 && hitRate < 0.08 ? 80 : 0);
      rows.push({
        address: wallet.address,
        name: wallet.name,
        url: wallet.url,
        image: wallet.image || null,
        realizedUsd,
        upnlUsd: upnl,
        totalUsd: Math.round((realizedUsd + upnl) * 100) / 100,
        earlyHits: hits.length,
        earlyPlays: plays.length,
        hitRate: Math.round(hitRate * 100),
        buys: wallet.buys,
        sells: wallet.sells,
        collections: wallet.collections.size,
        bags: bags.slice(0, MAX_BAGS_SHOWN),
        lastTs: wallet.lastTs,
        ageMin: Math.max(0, Math.round((now - wallet.lastTs) / 60000)),
        score: Math.round(score),
      });
    }
    return rows.sort((a, b) => b.score - a.score || b.totalUsd - a.totalUsd).slice(0, limit);
  }

  prune(now = Date.now()) {
    const stale = now - 36 * 60 * 60 * 1000;
    for (const [slug, col] of this.collections) {
      if (col.lastTs < stale && !col.pumped) this.collections.delete(slug);
    }
    if (this.collections.size > MAX_COLLECTIONS) {
      const ranked = [...this.collections.values()].sort((a, b) => b.lastTs - a.lastTs);
      this.collections = new Map(ranked.slice(0, MAX_COLLECTIONS).map((c) => [c.slug, c]));
    }
    const keep = new Set(
      this.board({ limit: MAX_WALLETS }).map((row) => row.address),
    );
    for (const [addr, wallet] of this.wallets) {
      if (keep.has(addr)) continue;
      if (wallet.lastTs < stale && wallet.hits.size === 0 && wallet.bags.size === 0) {
        this.wallets.delete(addr);
      }
    }
    if (this.wallets.size > MAX_WALLETS) {
      const ranked = [...this.wallets.values()].sort((a, b) => {
        const ha = a.hits.size * 10 + a.bags.size;
        const hb = b.hits.size * 10 + b.bags.size;
        return hb - ha || b.lastTs - a.lastTs;
      });
      this.wallets = new Map(ranked.slice(0, MAX_WALLETS).map((w) => [w.address, w]));
    }
    this.stats.wallets = this.wallets.size;
  }

  toJSON() {
    return {
      stats: this.stats,
      collections: [...this.collections.values()],
      wallets: [...this.wallets.values()].map((w) => ({
        address: w.address,
        name: w.name,
        url: w.url,
        image: w.image || null,
        buys: w.buys,
        sells: w.sells,
        mints: w.mints,
        realizedUsd: w.realizedUsd,
        untrackedSells: w.untrackedSells,
        lastTs: w.lastTs,
        earlyBuys: [...w.earlyBuys],
        hits: [...w.hits],
        collections: [...w.collections],
        bags: [...w.bags.entries()].map(([slug, tokens]) => [
          slug,
          [...tokens.entries()],
        ]),
      })),
    };
  }

  static fromJSON(raw) {
    const tracker = new TraderTracker();
    if (!raw || typeof raw !== "object") return tracker;
    tracker.stats = { ...tracker.stats, ...(raw.stats ?? {}) };
    for (const col of raw.collections ?? []) {
      if (col?.slug) tracker.collections.set(col.slug, col);
    }
    for (const w of raw.wallets ?? []) {
      if (!w?.address) continue;
      tracker.wallets.set(w.address, {
        ...w,
        earlyBuys: new Set(w.earlyBuys ?? []),
        hits: new Set(w.hits ?? []),
        collections: new Set(w.collections ?? []),
        bags: new Map(
          (w.bags ?? []).map(([slug, tokens]) => [slug, new Map(tokens ?? [])]),
        ),
      });
    }
    tracker.stats.wallets = tracker.wallets.size;
    return tracker;
  }
}
